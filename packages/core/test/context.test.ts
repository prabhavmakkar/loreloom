import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { Book, buildContext } from '../src/index.ts'

let book: Book
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'loreloom-'))
  book = await Book.createFromSample(join(dir, 'b'), resolve(import.meta.dirname, '../../../sample-book'))
})

test('has all headed sections', async () => {
  const ctx = await buildContext(book, { chapterId: 'salt-and-iron' })
  for (const h of ['## Book', '## Current chapter: Salt and Iron', '## World rules', '## Relevant world cards', '## Other chapters']) {
    expect(ctx).toContain(h)
  }
})

test('includes named-but-not-mentioned cards, excludes unrelated ones, includes all rules', async () => {
  const ctx = await buildContext(book, { chapterId: 'salt-and-iron' })
  expect(ctx).toContain('### Aldric Thorne (character)')
  expect(ctx).toContain('### Mira Vale (character)')
  expect(ctx).toContain('Iron repels ember-magic')
  expect(ctx).toContain('Oaths bind blood')
  const gate = await buildContext(book, { chapterId: 'the-ember-gate' })
  expect(gate).not.toContain('### Aldric Thorne')
  expect(gate).not.toContain('### The Ember Queen')
})

test('matches aliases case-insensitively at word boundaries', async () => {
  await book.saveChapter('the-ember-gate', { body: 'the NAIL-WRIGHT laughed. Mirage shimmered.' })
  const ctx = await buildContext(book, { chapterId: 'the-ember-gate' })
  expect(ctx).toContain('### Mira Vale (character)')
})

test('first word of a name alone does not match without an alias', async () => {
  await book.createCard('character', { name: 'Zane Brightwater' })
  await book.saveChapter('the-ember-gate', { body: 'Zane ran. Brightwater was far.' })
  const ctx = await buildContext(book, { chapterId: 'the-ember-gate' })
  expect(ctx).not.toContain('Zane Brightwater')
})

test('word boundary prevents partial matches', async () => {
  await book.saveChapter('the-ember-gate', { body: 'A mirage shimmered over Kaelstrom.' })
  const ctx = await buildContext(book, { chapterId: 'the-ember-gate' })
  expect(ctx).not.toContain('### Mira Vale')
  expect(ctx).not.toContain('### Kael Thorne')
})

test('other chapters are one-line summaries truncated to 200 chars', async () => {
  await book.saveChapter('the-oathbreaker', { summary: 'x'.repeat(300) })
  const ctx = await buildContext(book, { chapterId: 'salt-and-iron' })
  const other = ctx.split('## Other chapters')[1]!
  expect(other).toContain(`- The Oathbreaker: ${'x'.repeat(200)}\n`.trimEnd())
  expect(other).not.toContain('x'.repeat(201))
  expect(other).not.toContain('Salt and Iron')
})

test('selection yields Selected passage then Surrounding chapter', async () => {
  const ctx = await buildContext(book, { chapterId: 'salt-and-iron', selection: 'a swallowed coal' })
  const a = ctx.indexOf('## Selected passage')
  const b = ctx.indexOf('## Surrounding chapter')
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  expect(ctx).not.toContain('## Current chapter')
})

test('selection window is capped at 4000 chars either side', async () => {
  await book.saveChapter('the-ember-gate', { body: `${'a '.repeat(5000)}NEEDLE${' b'.repeat(5000)}` })
  const ctx = await buildContext(book, { chapterId: 'the-ember-gate', selection: 'NEEDLE' })
  const sur = ctx.split('## Surrounding chapter\n')[1]!.split('\n\n## ')[0]!
  expect(sur).toContain('NEEDLE')
  expect(sur.length).toBeLessThan(8100 + 100)
})

test('long chapter keeps its last 40,000 chars with a leading marker', async () => {
  const body = `START${'x'.repeat(49_990)}END!!`
  await book.saveChapter('the-ember-gate', { body })
  const ctx = await buildContext(book, { chapterId: 'the-ember-gate' })
  const cur = ctx.split('## Current chapter: The Ember Gate\n')[1]!.split('\n\n## ')[0]!
  expect(cur.startsWith('[…earlier text omitted…]\n')).toBe(true)
  expect(cur.endsWith('END!!')).toBe(true)
  expect(cur).not.toContain('START')
  expect(cur.length).toBe('[…earlier text omitted…]\n'.length + 40_000)
})
