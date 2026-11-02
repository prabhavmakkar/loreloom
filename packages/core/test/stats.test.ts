import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { Book, bookStats, countWords, pagesFor } from '../src/index.ts'

test('countWords ignores markdown syntax and counts mention labels', () => {
  expect(countWords('# Ch 1\n\nKael *pressed* his palm.\n\n***\n\n"It knows you," [Mira](@character/mira) said.')).toBe(11)
  expect(countWords('- one\n- two\n> three\n1. four')).toBe(4)
  expect(countWords('')).toBe(0)
})

test('pagesFor rounds up, zero is zero', () => {
  expect(pagesFor(0, 250)).toBe(0)
  expect(pagesFor(1, 250)).toBe(1)
  expect(pagesFor(251, 250)).toBe(2)
})

test('bookStats totals pages from total words', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'loreloom-'))
  const book = await Book.createFromSample(join(dir, 'b'), resolve(import.meta.dirname, '../../../sample-book'))
  const s = await bookStats(book)
  expect(s.chapters).toBe(3)
  expect(s.perChapter).toHaveLength(3)
  expect(s.words).toBe(s.perChapter.reduce((n, c) => n + c.words, 0))
  expect(s.pages).toBe(pagesFor(s.words, 250))
  expect(s.cards.rule).toBe(2)
  expect(s.cards.character).toBe(4)
})
