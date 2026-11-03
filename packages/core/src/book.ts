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
  /** Chapter read-modify-write operations run one at a time, so none overwrites another's changes. */
  private chapterLock: Promise<unknown> = Promise.resolve()
  /** The same for cards: a relationship edit must never clobber a body saved at the same moment. */
  private cardLock: Promise<unknown> = Promise.resolve()

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

  createChapter(input: { title: string }): Promise<Chapter> {
    return this.serialChapters(() => this.createChapterNow(input))
  }

  private async createChapterNow(input: { title: string }): Promise<Chapter> {
    const existing = await this.listChapters()
    const id = uniqueSlug(slugify(input.title), new Set(existing.map((c) => c.id)))
    const order = existing.reduce((m, c) => Math.max(m, c.order), 0) + 1
    return this.writeChapter({ id, title: input.title, order, status: 'idea', summary: '', body: '' })
  }

  private serialChapters<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chapterLock.then(op, op)
    this.chapterLock = run.catch(() => undefined)
    return run
  }

  saveChapter(id: string, patch: ChapterPatch, baseVersion?: string): Promise<Chapter> {
    return this.serialChapters(() => this.saveChapterNow(id, patch, baseVersion))
  }

  private async saveChapterNow(id: string, patch: ChapterPatch, baseVersion?: string): Promise<Chapter> {
    const current = await this.getChapter(id)
    if (baseVersion !== undefined && baseVersion !== current.version) {
      throw new ConflictError(`Chapter ${id} changed on disk`, current)
    }
    const { version: _v, ...rest } = current
    return this.writeChapter({ ...rest, ...pickChapterPatch(patch) })
  }

  deleteChapter(id: string): Promise<void> {
    return this.serialChapters(() => this.deleteChapterNow(id))
  }

  private async deleteChapterNow(id: string): Promise<void> {
    await this.getChapter(id)
    await this.trash(this.chapterPath(id), `${id}.md`)
  }

  reorderChapters(ids: string[]): Promise<Chapter[]> {
    return this.serialChapters(() => this.reorderChaptersNow(ids))
  }

  private async reorderChaptersNow(ids: string[]): Promise<Chapter[]> {
    const chapters = await this.listChapters()
    const have = new Set(chapters.map((c) => c.id))
    const want = new Set(ids)
    if (ids.length !== have.size || want.size !== ids.length || ids.some((i) => !have.has(i))) {
      throw new InvalidInputError('ids must be a permutation of the existing chapter ids')
    }
    const byId = new Map(chapters.map((c) => [c.id, c]))
    const out: Chapter[] = []
    for (const [i, id] of ids.entries()) {
      if (byId.get(id)!.order === i + 1) {
        out.push(byId.get(id)!)
        continue
      }
      // Re-read right before writing, so a change made since the snapshot is kept.
      const fresh = await this.getChapter(id)
      const { version: _v, ...rest } = fresh
      out.push(fresh.order === i + 1 ? fresh : await this.writeChapter({ ...rest, order: i + 1 }))
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

  private serialCards<T>(op: () => Promise<T>): Promise<T> {
    const run = this.cardLock.then(op, op)
    this.cardLock = run.catch(() => undefined)
    return run
  }

  createCard(kind: CardKind, input: { name: string; summary?: string; aliases?: string[] }): Promise<Card> {
    return this.serialCards(() => this.createCardNow(kind, input))
  }

  private async createCardNow(kind: CardKind, input: { name: string; summary?: string; aliases?: string[] }): Promise<Card> {
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

  saveCard(kind: CardKind, id: string, patch: CardPatch, baseVersion?: string): Promise<Card> {
    return this.serialCards(() => this.saveCardNow(kind, id, patch, baseVersion))
  }

  // The `*Now` variants assume the card lock is held; they call each other, never the locked ones.
  private async saveCardNow(kind: CardKind, id: string, patch: CardPatch, baseVersion?: string): Promise<Card> {
    const current = await this.getCard(kind, id)
    if (baseVersion !== undefined && baseVersion !== current.version) {
      throw new ConflictError(`${kind} ${id} changed on disk`, current)
    }
    const { version: _v, ...rest } = current
    return this.writeCard({ ...rest, ...pickCardPatch(patch) })
  }

  deleteCard(kind: CardKind, id: string): Promise<void> {
    return this.serialCards(() => this.deleteCardNow(kind, id))
  }

  private async deleteCardNow(kind: CardKind, id: string): Promise<void> {
    await this.getCard(kind, id)
    await this.trash(this.cardPath(kind, id), `${kind}-${id}.md`)
    if (kind !== 'character') return
    for (const c of await this.listCards('character')) {
      if (c.relationships.some((r) => r.to === id)) {
        await this.saveCardNow('character', c.id, { relationships: c.relationships.filter((r) => r.to !== id) })
      }
    }
  }

  addRelationship(fromId: string, rel: Relationship): Promise<Card> {
    return this.serialCards(() => this.addRelationshipNow(fromId, rel))
  }

  private async addRelationshipNow(fromId: string, rel: Relationship): Promise<Card> {
    checkId(fromId)
    checkId(rel.to)
    const from = await this.getCard('character', fromId)
    await this.getCard('character', rel.to)
    if (from.relationships.some((r) => r.to === rel.to && r.kind === rel.kind)) return from
    return this.saveCardNow('character', fromId, { relationships: [...from.relationships, rel] })
  }

  removeRelationship(fromId: string, rel: { to: string; kind: string }): Promise<Card> {
    return this.serialCards(() => this.removeRelationshipNow(fromId, rel))
  }

  private async removeRelationshipNow(fromId: string, rel: { to: string; kind: string }): Promise<Card> {
    const from = await this.getCard('character', fromId)
    return this.saveCardNow('character', fromId, {
      relationships: from.relationships.filter((r) => !(r.to === rel.to && r.kind === rel.kind)),
    })
  }
}

function str(patch: Record<string, unknown>, key: string, out: Record<string, unknown>): void {
  const v = patch[key]
  if (v === undefined) return
  if (typeof v !== 'string') throw new InvalidInputError(`${key} must be a string`)
  out[key] = v
}

function pickChapterPatch(patch: ChapterPatch): ChapterPatch {
  const p = patch as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['title', 'body', 'summary']) str(p, k, out)
  if (p.status !== undefined) {
    if (!STATUSES.includes(p.status as ChapterStatus)) throw new InvalidInputError(`Invalid status: ${String(p.status)}`)
    out.status = p.status
  }
  return out as ChapterPatch
}

function pickCardPatch(patch: CardPatch): CardPatch {
  const p = patch as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['name', 'summary', 'body']) str(p, k, out)
  if (p.aliases !== undefined) {
    if (!Array.isArray(p.aliases) || !p.aliases.every((a) => typeof a === 'string')) {
      throw new InvalidInputError('aliases must be an array of strings')
    }
    out.aliases = [...p.aliases]
  }
  if (p.relationships !== undefined) {
    const ok =
      Array.isArray(p.relationships) &&
      p.relationships.every(
        (r) =>
          r !== null &&
          typeof r === 'object' &&
          typeof r.to === 'string' &&
          typeof r.kind === 'string' &&
          (r.note === undefined || typeof r.note === 'string'),
      )
    if (!ok) throw new InvalidInputError('relationships must be an array of {to, kind, note?} strings')
    out.relationships = (p.relationships as Relationship[]).map((r) => {
      const rel: Relationship = { to: r.to, kind: r.kind }
      if (r.note !== undefined) rel.note = r.note
      return rel
    })
  }
  if (p.fields !== undefined) {
    const f = p.fields
    if (f === null || typeof f !== 'object' || Array.isArray(f) || Object.getPrototypeOf(f) !== Object.prototype) {
      throw new InvalidInputError('fields must be a plain object')
    }
    out.fields = f
  }
  return out as CardPatch
}
