import { createHash } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { InvalidInputError } from './errors.ts'

const FM_RE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?([\s\S]*)$/

/** Throws InvalidInputError when the frontmatter is not valid YAML. */
export function parseDoc(text: string): { data: Record<string, unknown>; body: string } {
  const m = FM_RE.exec(text)
  if (!m) return { data: {}, body: text }
  let data: unknown
  try {
    data = parse(m[1] ?? '')
  } catch (err) {
    throw new InvalidInputError(`The header (frontmatter) can't be read: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  }
  const isMap = data !== null && typeof data === 'object' && !Array.isArray(data)
  return { data: isMap ? (data as Record<string, unknown>) : {}, body: m[2] ?? '' }
}

export function stringifyDoc(data: Record<string, unknown>, body: string): string {
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n${body}`
}

export function contentVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}
