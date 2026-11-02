import type { BookMeta } from '@loreloom/core'
import type { AiMode } from './provider.ts'

const COMMON = [
  'You are a writing collaborator inside Loreloom, a novel-writing app.',
  'The prompt contains the book, the world cards and the chapter in progress. Treat the world cards as canon.',
  'Stay consistent with them. If a request conflicts with the cards or the manuscript, say so plainly instead of inventing facts.',
  'You may read files in the book folder to check details, but you cannot change them. The author decides what goes into the book.',
].join(' ')

export function systemPromptFor(mode: AiMode, meta: BookMeta): string {
  const book = `The book is "${meta.title}"${meta.author ? ` by ${meta.author}` : ''}.`
  switch (mode) {
    case 'brainstorm':
      return `${COMMON} ${book} Brainstorm with the author: offer 3 to 5 distinct options, each a short paragraph, and say briefly what each one opens up or costs.`
    case 'draft':
      return `${COMMON} ${book} Draft prose in the book's voice and tense. Output only the prose itself: no preamble, no commentary, and no markdown headings.`
    case 'review':
      return `${COMMON} ${book} Review mode is coming soon.`
  }
}
