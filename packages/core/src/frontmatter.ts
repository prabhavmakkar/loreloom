import { createHash } from 'node:crypto'
import { parse, stringify } from 'yaml'

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseDoc(text: string): { data: Record<string, unknown>; body: string } {
  const m = FM_RE.exec(text)
  if (!m) return { data: {}, body: text }
  const data = parse(m[1] ?? '')
  const isMap = data !== null && typeof data === 'object' && !Array.isArray(data)
  return { data: isMap ? (data as Record<string, unknown>) : {}, body: m[2] ?? '' }
}

export function stringifyDoc(data: Record<string, unknown>, body: string): string {
  return `---\n${stringify(data).trimEnd()}\n---\n${body}`
}

export function contentVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}
