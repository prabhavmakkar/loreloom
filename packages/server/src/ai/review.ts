import type { ReviewCategory, ReviewSuggestion } from './provider.ts'

export type { ReviewCategory, ReviewSuggestion }

const CATEGORIES: readonly ReviewCategory[] = ['prose', 'pacing', 'continuity', 'dialogue']
const MAX_QUOTE = 300

function parseLine(line: string, id: string): ReviewSuggestion | null {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  let o: unknown
  try {
    o = JSON.parse(t)
  } catch {
    return null
  }
  if (typeof o !== 'object' || o === null) return null
  const { quote, issue, fix, category } = o as Record<string, unknown>
  if (typeof quote !== 'string' || quote.trim() === '' || quote.length > MAX_QUOTE) return null
  if (typeof issue !== 'string' || issue.trim() === '') return null
  if (typeof fix !== 'string') return null // an empty fix means "cut this"
  if (typeof category !== 'string' || !CATEGORIES.includes(category as ReviewCategory)) return null
  return { id, quote, issue, fix, category: category as ReviewCategory }
}

/**
 * Turns the model's streamed text (one JSON object per line) into suggestions as each line
 * completes. Anything that isn't a valid suggestion, including code fences, is skipped.
 */
export function createReviewParser(): { push(text: string): ReviewSuggestion[]; end(): ReviewSuggestion[] } {
  let buffer = ''
  let n = 0
  const take = (line: string, out: ReviewSuggestion[]) => {
    const s = parseLine(line, `r${n + 1}`)
    if (s) {
      n++
      out.push(s)
    }
  }
  return {
    push(text) {
      buffer += text
      const out: ReviewSuggestion[] = []
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const l of lines) take(l, out)
      return out
    },
    end() {
      const out: ReviewSuggestion[] = []
      const rest = buffer
      buffer = ''
      take(rest, out)
      return out
    },
  }
}
