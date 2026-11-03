const QUOTES = /[‘’‚‛′]/
const DQUOTES = /[“”„‟″]/
const DASHES = /[‐-―−]/

/** Normalized text plus, for each normalized char, the offset of its source char. */
function normalize(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (/\s/.test(ch)) {
      if (!space) {
        text += ' '
        map.push(i)
      }
      space = true
      continue
    }
    space = false
    text += QUOTES.test(ch) ? "'" : DQUOTES.test(ch) ? '"' : DASHES.test(ch) ? '-' : ch
    map.push(i)
  }
  return { text, map }
}

/** Markdown the helper may leave in a quote although the chapter's plain text has none. */
function stripMarkdown(quote: string): string {
  return quote
    .replace(/\[([^\]]*)\]\(@[a-z]+\/[^)\s]*\)/g, '$1') // [Label](@kind/id) -> Label
    .replace(/(?<!\\)[*_]/g, '') // emphasis markers
    .replace(/\\(.)/g, '$1') // backslash escapes
}

function countOf(hay: string, needle: string): number {
  let n = 0
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n++
  return n
}

/**
 * Finds `quote` in `plainText`: exactly first, then ignoring whitespace runs, curly versus
 * straight quotes, dash variants and stray markdown. Offsets are into `plainText`; `count`
 * is how many times the passage appears (more than one means the match is ambiguous).
 */
export function findQuote(plainText: string, quote: string): { from: number; to: number; count: number } | null {
  if (quote.trim() === '') return null
  const hay = normalize(plainText)
  const exact = plainText.indexOf(quote)
  if (exact >= 0) {
    const fuzzyCount = countOf(hay.text, normalize(quote.trim()).text)
    return { from: exact, to: exact + quote.length, count: Math.max(countOf(plainText, quote), fuzzyCount) }
  }
  for (const candidate of [quote.trim(), stripMarkdown(quote).trim()]) {
    const needle = normalize(candidate).text
    if (needle === '') continue
    const i = hay.text.indexOf(needle)
    if (i < 0) continue
    const last = i + needle.length - 1
    return { from: hay.map[i]!, to: hay.map[last]! + 1, count: countOf(hay.text, needle) }
  }
  return null
}
