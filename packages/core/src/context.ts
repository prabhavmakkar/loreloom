import type { Book } from './book.ts'
import { extractMentions } from './mentions.ts'
import type { Card } from './types.ts'

export interface ContextRequest {
  chapterId?: string
  selection?: string
}

const CHAPTER_CAP = 40_000
const SELECTION_WINDOW = 4_000
const SUMMARY_CAP = 200
const OMITTED = '[…earlier text omitted…]'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function names(card: Card): string[] {
  return [card.name, ...card.aliases].map((n) => n.trim()).filter(Boolean)
}

function isNamedIn(card: Card, text: string): boolean {
  return names(card).some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'iu').test(text))
}

function capChapter(body: string): string {
  return body.length > CHAPTER_CAP ? `${OMITTED}\n${body.slice(-CHAPTER_CAP)}` : body
}

function window(body: string, selection: string): string {
  const i = body.indexOf(selection)
  if (i < 0) return capChapter(body)
  const start = Math.max(0, i - SELECTION_WINDOW)
  const end = Math.min(body.length, i + selection.length + SELECTION_WINDOW)
  return `${start > 0 ? `${OMITTED}\n` : ''}${body.slice(start, end)}${end < body.length ? '\n[…later text omitted…]' : ''}`
}

function formatCard(c: Card): string {
  const lines = [`### ${c.name} (${c.kind})`]
  if (c.aliases.length) lines.push(`Aliases: ${c.aliases.join(', ')}`)
  if (c.summary) lines.push(c.summary)
  if (c.relationships.length) {
    lines.push(`Relationships: ${c.relationships.map((r) => `${r.kind} ${r.to}${r.note ? ` (${r.note})` : ''}`).join('; ')}`)
  }
  if (c.body.trim()) lines.push(c.body.trim())
  return lines.join('\n')
}

export async function buildContext(book: Book, req: ContextRequest): Promise<string> {
  const chapters = await book.listChapters()
  const current = req.chapterId ? chapters.find((c) => c.id === req.chapterId) : undefined
  const cards = await book.listCards()
  const sections: string[] = []

  const meta = [`## Book`, `Title: ${book.meta.title}`]
  if (book.meta.author) meta.push(`Author: ${book.meta.author}`)
  sections.push(meta.join('\n'))

  const probe = [current?.body ?? '', req.selection ?? ''].join('\n')
  if (current) {
    if (req.selection) {
      sections.push(`## Selected passage\n${req.selection}`)
      sections.push(`## Surrounding chapter\n${window(current.body, req.selection)}`)
    } else {
      sections.push(`## Current chapter: ${current.title}\n${capChapter(current.body)}`)
    }
  } else if (req.selection) {
    sections.push(`## Selected passage\n${req.selection}`)
  }

  const rules = cards.filter((c) => c.kind === 'rule')
  sections.push(`## World rules\n${rules.length ? rules.map(formatCard).join('\n\n') : '(none)'}`)

  const mentioned = new Set(extractMentions(probe).map((m) => `${m.kind}/${m.id}`))
  const relevant = cards.filter(
    (c) => c.kind !== 'rule' && (mentioned.has(`${c.kind}/${c.id}`) || isNamedIn(c, probe)),
  )
  sections.push(`## Relevant world cards\n${relevant.length ? relevant.map(formatCard).join('\n\n') : '(none)'}`)

  const others = chapters.filter((c) => c.id !== current?.id)
  const lines = others.map((c) => `- ${c.title}: ${c.summary.slice(0, SUMMARY_CAP)}`)
  sections.push(`## Other chapters\n${lines.length ? lines.join('\n') : '(none)'}`)

  return sections.join('\n\n')
}
