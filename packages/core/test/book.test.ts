import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  Book,
  BookExistsError,
  ConflictError,
  InvalidIdError,
  InvalidInputError,
  NotABookError,
  NotFoundError,
} from '../src/index.ts'

const SAMPLE = resolve(import.meta.dirname, '../../../sample-book')
let dir: string
let book: Book

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'loreloom-book-'))
  book = await Book.create(dir, { title: 'T', author: 'A' })
})

test('create writes book.yaml and rejects a second create', async () => {
  expect(await readFile(join(dir, 'book.yaml'), 'utf8')).toContain('wordsPerPage: 250')
  expect(book.meta).toEqual({ title: 'T', author: 'A', wordsPerPage: 250 })
  expect(await Book.isBook(dir)).toBe(true)
  await expect(Book.create(dir, { title: 'T', author: 'A' })).rejects.toBeInstanceOf(BookExistsError)
})

test('open on an empty dir throws NotABookError; open works on a book', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'loreloom-empty-'))
  expect(await Book.isBook(empty)).toBe(false)
  await expect(Book.open(empty)).rejects.toBeInstanceOf(NotABookError)
  expect((await Book.open(dir)).meta.title).toBe('T')
})

test('updateMeta persists', async () => {
  await book.updateMeta({ title: 'New' })
  expect((await Book.open(dir)).meta.title).toBe('New')
})

test('createChapter makes unique ids and increasing order', async () => {
  const a = await book.createChapter({ title: 'The Ember Gate' })
  const b = await book.createChapter({ title: 'The Ember Gate' })
  expect([a.id, a.order, a.status]).toEqual(['the-ember-gate', 1, 'idea'])
  expect([b.id, b.order]).toEqual(['the-ember-gate-2', 2])
})

test('saveChapter detects stale versions', async () => {
  const c = await book.createChapter({ title: 'One' })
  const saved = await book.saveChapter(c.id, { body: 'mine' }, c.version)
  expect(saved.version).not.toBe(c.version)
  expect(saved.body).toBe('mine')
  await writeFile(join(dir, 'chapters', 'one.md'), '---\nid: one\ntitle: One\norder: 1\nstatus: idea\nsummary: ""\n---\ntheirs')
  const err = await book.saveChapter(c.id, { body: 'x' }, saved.version).catch((e) => e)
  expect(err).toBeInstanceOf(ConflictError)
  expect(err.current.body).toBe('theirs')
  await expect(book.saveChapter(c.id, { body: 'x' }, 'stale')).rejects.toBeInstanceOf(ConflictError)
})

test('title change keeps id; patch fields persist', async () => {
  const c = await book.createChapter({ title: 'One' })
  await book.saveChapter(c.id, { title: 'Renamed', status: 'drafting', summary: 'S' })
  const got = await book.getChapter('one')
  expect([got.id, got.title, got.status, got.summary]).toEqual(['one', 'Renamed', 'drafting', 'S'])
})

test('invalid ids throw InvalidIdError', async () => {
  await expect(book.getChapter('../book')).rejects.toBeInstanceOf(InvalidIdError)
  await expect(book.saveChapter('a/b', {})).rejects.toBeInstanceOf(InvalidIdError)
  await expect(book.deleteChapter('..')).rejects.toBeInstanceOf(InvalidIdError)
  await expect(book.getCard('character', '../x')).rejects.toBeInstanceOf(InvalidIdError)
  await expect(book.getChapter('missing')).rejects.toBeInstanceOf(NotFoundError)
})

test('reorderChapters requires a permutation', async () => {
  const a = await book.createChapter({ title: 'A' })
  const b = await book.createChapter({ title: 'B' })
  await expect(book.reorderChapters([a.id])).rejects.toBeInstanceOf(InvalidInputError)
  await expect(book.reorderChapters([a.id, b.id, 'zzz'])).rejects.toBeInstanceOf(InvalidInputError)
  await expect(book.reorderChapters([a.id, a.id])).rejects.toBeInstanceOf(InvalidInputError)
  const out = await book.reorderChapters([b.id, a.id])
  expect(out.map((c) => c.id)).toEqual(['b', 'a'])
  expect((await book.listChapters()).map((c) => c.id)).toEqual(['b', 'a'])
})

test('deleteChapter moves the file to trash', async () => {
  const c = await book.createChapter({ title: 'Gone' })
  await book.deleteChapter(c.id)
  expect(await book.listChapters()).toEqual([])
  const trash = await readdir(join(dir, '.loreloom', 'trash'))
  expect(trash).toHaveLength(1)
  expect(trash[0]).toMatch(/-gone\.md$/)
})

test('card fields round-trip', async () => {
  const t = await book.createCard('term', { name: 'Ashbound' })
  expect(t.id).toBe('ashbound')
  await book.saveCard('term', 'ashbound', { fields: { pronunciation: 'ASH-bownd' } })
  const got = await book.getCard('term', 'ashbound')
  expect(got.fields).toEqual({ pronunciation: 'ASH-bownd' })
  expect(got.name).toBe('Ashbound')
  expect((await book.listCards('term')).map((c) => c.id)).toEqual(['ashbound'])
})

test('saveCard detects stale versions', async () => {
  const c = await book.createCard('place', { name: 'Gate' })
  await book.saveCard('place', 'gate', { summary: 'x' }, c.version)
  await expect(book.saveCard('place', 'gate', { summary: 'y' }, c.version)).rejects.toBeInstanceOf(ConflictError)
})

test('relationships: validate target, dedupe, remove', async () => {
  await book.createCard('character', { name: 'Mira' })
  await book.createCard('character', { name: 'Kael' })
  await expect(book.addRelationship('mira', { to: 'nobody', kind: 'trusts' })).rejects.toBeInstanceOf(NotFoundError)
  await book.addRelationship('mira', { to: 'kael', kind: 'trusts' })
  const mira = await book.addRelationship('mira', { to: 'kael', kind: 'trusts' })
  expect(mira.relationships).toEqual([{ to: 'kael', kind: 'trusts' }])
  const after = await book.removeRelationship('mira', { to: 'kael', kind: 'trusts' })
  expect(after.relationships).toEqual([])
})

test('deleteCard on a character strips relationships pointing to it', async () => {
  await book.createCard('character', { name: 'Mira' })
  await book.createCard('character', { name: 'Kael' })
  await book.addRelationship('mira', { to: 'kael', kind: 'trusts' })
  await book.deleteCard('character', 'kael')
  expect((await book.getCard('character', 'mira')).relationships).toEqual([])
  expect(await book.listCards('character')).toHaveLength(1)
  expect(await readdir(join(dir, '.loreloom', 'trash'))).toHaveLength(1)
})

test('wasWrittenByMe tracks own writes only', async () => {
  const c = await book.createChapter({ title: 'One' })
  await book.saveChapter(c.id, { body: 'hello' })
  const p = join(dir, 'chapters', 'one.md')
  const text = await readFile(p, 'utf8')
  expect(book.wasWrittenByMe(p, text)).toBe(true)
  await writeFile(p, text + 'external')
  expect(book.wasWrittenByMe(p, text + 'external')).toBe(false)
})

test('createFromSample copies the sample book', async () => {
  const target = join(await mkdtemp(join(tmpdir(), 'loreloom-sample-')), 'b')
  const b = await Book.createFromSample(target, SAMPLE)
  expect((await b.listChapters()).length).toBe(3)
  expect(await b.listCards('character')).toHaveLength(4)
  expect(await b.listCards('place')).toHaveLength(2)
  expect(await b.listCards('rule')).toHaveLength(2)
  expect(await b.listCards('term')).toHaveLength(3)
  expect((await b.getCard('term', 'ashbound')).fields.pronunciation).toBeTruthy()
  expect((await b.getCard('rule', 'iron-and-ember')).name).toMatch(/iron/i)
  await expect(Book.createFromSample(target, SAMPLE)).rejects.toBeInstanceOf(BookExistsError)
})

test('saveChapter ignores non-whitelisted keys and rejects bad types', async () => {
  const c = await book.createChapter({ title: 'One' })
  const out = await book.saveChapter(c.id, { id: '../evil', order: 99, version: 'x', body: 'x' } as any)
  expect([out.id, out.order, out.body]).toEqual(['one', 1, 'x'])
  expect(await readdir(dir)).not.toContain('evil.md')
  expect(await readdir(join(dir, 'chapters'))).toEqual(['one.md'])
  for (const bad of [{ body: null }, { title: 5 }, { summary: {} }, { status: 'nope' }]) {
    await expect(book.saveChapter(c.id, bad as any)).rejects.toBeInstanceOf(InvalidInputError)
  }
})

test('saveCard ignores id/kind and validates types', async () => {
  await book.createCard('place', { name: 'Gate' })
  const out = await book.saveCard('place', 'gate', { id: '../../x', kind: 'rule', summary: 's' } as any)
  expect([out.id, out.kind, out.summary]).toEqual(['gate', 'place', 's'])
  expect(await readdir(join(dir, 'world', 'places'))).toEqual(['gate.md'])
  for (const bad of [
    { name: 1 },
    { aliases: 'a' },
    { aliases: [1] },
    { relationships: [{ to: 'x' }] },
    { relationships: 'no' },
    { fields: [] },
    { fields: null },
    { body: null },
  ]) {
    await expect(book.saveCard('place', 'gate', bad as any)).rejects.toBeInstanceOf(InvalidInputError)
  }
})

test('concurrent reorderChapters end consistent, matching the last call', async () => {
  const [a, b, c, d] = [await book.createChapter({ title: 'A' }), await book.createChapter({ title: 'B' }), await book.createChapter({ title: 'C' }), await book.createChapter({ title: 'D' })]
  const calls = [[d, c, b, a], [b, a, d, c], [c, d, a, b], [a, c, b, d]].map((o) => book.reorderChapters(o.map((x) => x.id)))
  await Promise.all(calls)
  const list = await book.listChapters()
  expect(list.map((x) => x.order)).toEqual([1, 2, 3, 4])
  expect(list.map((x) => x.id)).toEqual([a, c, b, d].map((x) => x.id))
})

test('a body saved while a reorder runs survives it', async () => {
  const a = await book.createChapter({ title: 'A' })
  const b = await book.createChapter({ title: 'B' })
  await Promise.all([book.reorderChapters([b.id, a.id]), book.saveChapter(a.id, { body: 'kept text' })])
  const got = await book.getChapter(a.id)
  expect(got.body).toBe('kept text')
  expect(got.order).toBe(2)
})

test('a concurrent card save and relationship edit keep both changes', async () => {
  const kael = await book.createCard('character', { name: 'Kael' })
  await book.createCard('character', { name: 'Mira' })
  await Promise.all([book.saveCard('character', kael.id, { body: 'new body' }, kael.version), book.addRelationship(kael.id, { to: 'mira', kind: 'ally' })])
  const after = await book.getCard('character', kael.id)
  expect(after.body).toBe('new body')
  expect(after.relationships).toEqual([{ to: 'mira', kind: 'ally' }])
})
