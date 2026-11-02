import type { Book } from './book.ts'
import type { CardKind } from './types.ts'

export function countWords(markdown: string): number {
  const text = markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>+\s?/gm, '')
    .replace(/^\s*([-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_]/g, ' ')
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

export function pagesFor(words: number, wordsPerPage: number): number {
  return words > 0 ? Math.ceil(words / wordsPerPage) : 0
}

export interface BookStats {
  words: number
  pages: number
  chapters: number
  perChapter: { id: string; words: number; pages: number }[]
  cards: Record<CardKind, number>
}

export async function bookStats(book: Book): Promise<BookStats> {
  const wpp = book.meta.wordsPerPage
  const chapters = await book.listChapters()
  const perChapter = chapters.map((c) => {
    const words = countWords(c.body)
    return { id: c.id, words, pages: pagesFor(words, wpp) }
  })
  const words = perChapter.reduce((n, c) => n + c.words, 0)
  const cards: Record<CardKind, number> = { character: 0, place: 0, rule: 0, term: 0 }
  for (const c of await book.listCards()) cards[c.kind]++
  return { words, pages: pagesFor(words, wpp), chapters: chapters.length, perChapter, cards }
}
