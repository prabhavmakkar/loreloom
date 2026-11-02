import { cp, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { BookExistsError, ConflictError, InvalidIdError, InvalidInputError, NotABookError, NotFoundError } from './errors.ts'
import { contentVersion, parseDoc, stringifyDoc } from './frontmatter.ts'
import { writeFileAtomic } from './fsAtomic.ts'
import { isValidId, slugify, uniqueSlug } from './slug.ts'
import { CARD_DIRS } from './types.ts'
import type { BookMeta, Card, CardKind, Chapter, ChapterStatus, Relationship } from './types.ts'

const STATUSES: ChapterStatus[] = ['idea', 'drafting', 'revising', 'done']
const CARD_KEYS = new Set(['id', 'name', 'aliases', 'summary', 'relationships'])
const WORLD_DIRS = Object.values(CARD_DIRS)

type ChapterPatch = Partial<Pick<Chapter, 'title' | 'body' | 'status' | 'summary'>>
type CardPatch = Partial<Omit<Card, 'kind' | 'id' | 'version'>>

function checkId(id: string): void {
  if (typeof id !== 'string' || !isValidId(id)) throw new InvalidIdError(`Invalid id: ${String(id)}`)
}

function checkKind(kind: string): asserts kind is CardKind {
  if (!(kind in CARD_DIRS)) throw new InvalidInputError(`Unknown card kind: ${kind}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}

function parseMeta(text: string): BookMeta {
  const d = (parse(text) ?? {}) as Record<string, unknown>
  const wpp = Number(d.wordsPerPage)
  return {
    title: asString(d.title),
    author: asString(d.author),
    wordsPerPage: Number.isFinite(wpp) && wpp > 0 ? wpp : 250,
  }
}

export class Book {
  readonly dir: string
  meta: BookMeta
  private readonly written = new Map<string, string>()

  private constructor(dir: string, meta: BookMeta) {
    this.dir = dir
    this.meta = meta
  }

  static async isBook(dir: string): Promise<boolean> {
    return exists(join(dir, 'book.yaml'))
  }

  static async create(dir: string, opts: { title: string; author: string }): Promise<Book> {
    if (await Book.isBook(dir)) throw new BookExistsError(`A book already exists in ${dir}`)
    await mkdir(join(dir, 'chapters'), { recursive: true })
    for (const d of WORLD_DIRS) await mkdir(join(dir, 'world', d), { recursive: true })
    const book = new Book(dir, { title: opts.title, author: opts.author, wordsPerPage: 250 })
    await book.writeMeta()
    return book
  }

  static async createFromSample(dir: string, sampleDir: string): Promise<Book> {
    if (await Book.isBook(dir)) throw new BookExistsError(`A book already exists in ${dir}`)
    await mkdir(dir, { recursive: true })
    await cp(sampleDir, dir, { recursive: true })
    return Book.open(dir)
  }

  static async open(dir: string): Promise<Book> {
    const text = await readIfExists(join(dir, 'book.yaml'))
    if (text === null) throw new NotABookError(`Not a Loreloom book: ${dir}`)
    return new Book(dir, parseMeta(text))
  }

  private async write(path: string, content: string): Promise<void> {
    await writeFileAtomic(path, content)
    this.written.set(path, contentVersion(content))
  }

  private writeMeta(): Promise<void> {
    return this.write(join(this.dir, 'book.yaml'), stringify(this.meta, { lineWidth: 0 }))
  }

  wasWrittenByMe(absPath: string, content: string): boolean {
    return this.written.get(absPath) === contentVersion(content)
  }

  private async trash(path: string, name: string): Promise<void> {
    const trashDir = join(this.dir, '.loreloom', 'trash')
    await mkdir(trashDir, { recursive: true })
    await rename(path, join(trashDir, `${Date.now()}-${name}`))
  }

  async updateMeta(patch: Partial<BookMeta>): Promise<BookMeta> {
    this.meta = { ...this.meta, ...patch }
    await this.writeMeta()
    return this.meta
  }

  // ---- chapters ----

  private chapterPath(id: string): string {
    return join(this.dir, 'chapters', `${id}.md`)
  }

  private chapterFromText(id: string, text: string): Chapter {
    const { data, body } = parseDoc(text)
    const status = STATUSES.includes(data.status as ChapterStatus) ? (data.status as ChapterStatus) : 'idea'
    const order = Number(data.order)
    return {
      id,
      title: asString(data.title, id),
      order: Number.isFinite(order) ? order : 0,
      status,
      summary: asString(data.summary),
      body,
      version: contentVersion(text),
    }
  }

  private async writeChapter(c: Omit<Chapter, 'version'>): Promise<Chapter> {
    const text = stringifyDoc(
      { id: c.id, title: c.title, order: c.order, status: c.status, summary: c.summary },
      c.body,
    )
    await this.write(this.chapterPath(c.id), text)
    return { ...c, version: contentVersion(text) }
  }

  async listChapters(): Promise<Chapter[]> {
    let files: string[]
    try {
      files = await readdir(join(this.dir, 'chapters'))
    } catch {
      return []
    }
    const out: Chapter[] = []
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const id = f.slice(0, -3)
      if (!isValidId(id)) continue
      out.push(this.chapterFromText(id, await readFile(this.chapterPath(id), 'utf8')))
    }
    return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  async getChapter(id: string): Promise<Chapter> {
    checkId(id)
    const text = await readIfExists(this.chapterPath(id))
    if (text === null) throw new NotFoundError(`Chapter not found: ${id}`)
    return this.chapterFromText(id, text)
  }

  async createChapter(input: { title: string }): Promise<Chapter> {
    const existing = await this.listChapters()
    const id = uniqueSlug(slugify(input.title), new Set(existing.map((c) => c.id)))
    const order = existing.reduce((m, c) => Math.max(m, c.order), 0) + 1
    return this.writeChapter({ id, title: input.title, order, status: 'idea', summary: '', body: '' })
  }

  async saveChapter(id: string, patch: ChapterPatch, baseVersion?: string): Promise<Chapter> {
    const current = await this.getChapter(id)
    if (baseVersion !== undefined && baseVersion !== current.version) {
      throw new ConflictError(`Chapter ${id} changed on disk`, current)
    }
    if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
      throw new InvalidInputError(`Invalid status: ${patch.status}`)
    }
    const { version: _v, ...rest } = current
    return this.writeChapter({ ...rest, ...definedOnly(patch) })
  }

  async deleteChapter(id: string): Promise<void> {
    await this.getChapter(id)
    await this.trash(this.chapterPath(id), `${id}.md`)
  }

  async reorderChapters(ids: string[]): Promise<Chapter[]> {
    const chapters = await this.listChapters()
    const have = new Set(chapters.map((c) => c.id))
    const want = new Set(ids)
    if (ids.length !== have.size || want.size !== ids.length || ids.some((i) => !have.has(i))) {
      throw new InvalidInputError('ids must be a permutation of the existing chapter ids')
    }
    const byId = new Map(chapters.map((c) => [c.id, c]))
    const out: Chapter[] = []
    for (const [i, id] of ids.entries()) {
      const { version: _v, ...rest } = byId.get(id)!
      out.push(rest.order === i + 1 ? byId.get(id)! : await this.writeChapter({ ...rest, order: i + 1 }))
    }
    return out
  }

  // ---- cards ----

  private cardPath(kind: CardKind, id: string): string {
    return join(this.dir, 'world', CARD_DIRS[kind], `${id}.md`)
  }

  private cardFromText(kind: CardKind, id: string, text: string): Card {
    const { data, body } = parseDoc(text)
    const aliases = Array.isArray(data.aliases) ? data.aliases.map((a) => asString(a)) : []
    const relationships: Relationship[] = Array.isArray(data.relationships)
      ? data.relationships
          .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
          .map((r) => {
            const rel: Relationship = { to: asString(r.to), kind: asString(r.kind) }
            if (r.note != null) rel.note = asString(r.note)
            return rel
          })
      : []
    const fields = Object.fromEntries(Object.entries(data).filter(([k]) => !CARD_KEYS.has(k)))
    return {
      kind,
      id,
      name: asString(data.name, id),
      aliases,
      summary: asString(data.summary),
      body,
      relationships,
      fields,
      version: contentVersion(text),
    }
  }

  private async writeCard(c: Omit<Card, 'version'>): Promise<Card> {
    const data: Record<string, unknown> = { id: c.id, name: c.name }
    if (c.aliases.length) data.aliases = c.aliases
    data.summary = c.summary
    if (c.relationships.length) data.relationships = c.relationships
    for (const [k, v] of Object.entries(c.fields)) if (!CARD_KEYS.has(k)) data[k] = v
    const text = stringifyDoc(data, c.body)
    await this.write(this.cardPath(c.kind, c.id), text)
    return { ...c, version: contentVersion(text) }
  }

  async listCards(kind?: CardKind): Promise<Card[]> {
    const kinds = kind ? [kind] : (Object.keys(CARD_DIRS) as CardKind[])
    const out: Card[] = []
    for (const k of kinds) {
      checkKind(k)
      let files: string[]
      try {
        files = await readdir(join(this.dir, 'world', CARD_DIRS[k]))
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith('.md')) continue
        const id = f.slice(0, -3)
        if (!isValidId(id)) continue
        out.push(this.cardFromText(k, id, await readFile(this.cardPath(k, id), 'utf8')))
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  async getCard(kind: CardKind, id: string): Promise<Card> {
    checkKind(kind)
    checkId(id)
    const text = await readIfExists(this.cardPath(kind, id))
    if (text === null) throw new NotFoundError(`${kind} not found: ${id}`)
    return this.cardFromText(kind, id, text)
  }

  async createCard(
    kind: CardKind,
    input: { name: string; summary?: string; aliases?: string[] },
  ): Promise<Card> {
    checkKind(kind)
    const existing = await this.listCards(kind)
    const id = uniqueSlug(slugify(input.name), new Set(existing.map((c) => c.id)))
    return this.writeCard({
      kind,
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      summary: input.summary ?? '',
      body: '',
      relationships: [],
      fields: {},
    })
  }

  async saveCard(kind: CardKind, id: string, patch: CardPatch, baseVersion?: string): Promise<Card> {
    const current = await this.getCard(kind, id)
    if (baseVersion !== undefined && baseVersion !== current.version) {
      throw new ConflictError(`${kind} ${id} changed on disk`, current)
    }
    const { version: _v, ...rest } = current
    return this.writeCard({ ...rest, ...definedOnly(patch) })
  }

  async deleteCard(kind: CardKind, id: string): Promise<void> {
    await this.getCard(kind, id)
    await this.trash(this.cardPath(kind, id), `${kind}-${id}.md`)
    if (kind !== 'character') return
    for (const c of await this.listCards('character')) {
      if (c.relationships.some((r) => r.to === id)) {
        await this.saveCard('character', c.id, { relationships: c.relationships.filter((r) => r.to !== id) })
      }
    }
  }

  async addRelationship(fromId: string, rel: Relationship): Promise<Card> {
    checkId(fromId)
    checkId(rel.to)
    const from = await this.getCard('character', fromId)
    await this.getCard('character', rel.to)
    if (from.relationships.some((r) => r.to === rel.to && r.kind === rel.kind)) return from
    return this.saveCard('character', fromId, { relationships: [...from.relationships, rel] })
  }

  async removeRelationship(fromId: string, rel: { to: string; kind: string }): Promise<Card> {
    const from = await this.getCard('character', fromId)
    return this.saveCard('character', fromId, {
      relationships: from.relationships.filter((r) => !(r.to === rel.to && r.kind === rel.kind)),
    })
  }
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}
