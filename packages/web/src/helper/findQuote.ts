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

/**
 * Finds `quote` in `plainText`: exactly first, then ignoring whitespace runs, curly versus
 * straight quotes and dash variants. Offsets are into `plainText`.
 */
export function findQuote(plainText: string, quote: string): { from: number; to: number } | null {
  if (quote.trim() === '') return null
  const exact = plainText.indexOf(quote)
  if (exact >= 0) return { from: exact, to: exact + quote.length }
  const hay = normalize(plainText)
  const needle = normalize(quote.trim()).text
  const i = hay.text.indexOf(needle)
  if (i < 0) return null
  const last = i + needle.length - 1
  return { from: hay.map[i]!, to: hay.map[last]! + 1 }
}
