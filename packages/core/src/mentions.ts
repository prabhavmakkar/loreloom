import type { CardKind } from './types.ts'

export const MENTION_RE = /\[([^\]]*)\]\(@(character|place|rule|term)\/([^)\s]+)\)/g

export function extractMentions(markdown: string): { kind: CardKind; id: string }[] {
  const seen = new Set<string>()
  const out: { kind: CardKind; id: string }[] = []
  for (const m of markdown.matchAll(MENTION_RE)) {
    const kind = m[2] as CardKind
    const id = m[3]!
    const key = `${kind}/${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id })
  }
  return out
}
