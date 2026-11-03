import type { ReactNode } from 'react'
import type { RunError } from './stream.ts'

export const NOT_INSTALLED = "Loreloom's helper runs on Claude Code. Install it from https://code.claude.com, then reload."
export const NOT_LOGGED_IN = 'Open a terminal and run `claude`, then `/login`.'
export const UNRESPONSIVE = "Claude Code didn't answer in time. Check that `claude` starts in a terminal, then try again."
export const RATE_LIMITED = "You've reached your Claude usage limit for now. It resets after a while; your writing is unaffected."

/** Inline `code`, **bold** and *italic*, built as elements so model output is never parsed as HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![*\w])\*([^*\s][^*]*?)\*(?!\w)|(?<![_\w])_([^_\s][^_]*?)_(?!\w)/g
  let last = 0
  let n = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${n++}`
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>)
    else if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>)
    else out.push(<em key={k}>{m[3] ?? m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBER = /^\s*\d+[.)]\s+(.*)$/

/** A deliberately small Markdown subset: paragraphs, headings (as bold lines), lists, bold, italic. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const list = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null
    if (list) {
      const items: string[] = []
      while (i < lines.length && list.test(lines[i]!)) items.push(list.exec(lines[i++]!)![1]!)
      const Tag = list === BULLET ? 'ul' : 'ol'
      blocks.push(
        <Tag key={blocks.length}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${blocks.length}-${j}`)}</li>
          ))}
        </Tag>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !BULLET.test(lines[i]!) && !NUMBER.test(lines[i]!)) para.push(lines[i++]!.replace(/^#{1,6}\s+/, ''))
    const heading = /^#{1,6}\s/.test(line)
    blocks.push(
      <p key={blocks.length} className={heading ? 'rt-heading' : undefined}>
        {para.flatMap((l, j) => (j === 0 ? inline(l, `${blocks.length}-${j}`) : [<br key={`br${j}`} />, ...inline(l, `${blocks.length}-${j}`)]))}
      </p>,
    )
  }
  return <div className="richtext">{blocks}</div>
}

export function ActivityLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <ul className="activity" aria-label="What the helper is doing">
      {lines.slice(-4).map((l, i) => (
        <li key={`${lines.length - 4 + i}-${l}`}>{l}</li>
      ))}
    </ul>
  )
}

/** Inline error for a failed run. A cancelled run never reaches here. */
export function RunNotice({ error, onRetry }: { error: RunError; onRetry?: () => void }) {
  const message =
    error.code === 'rate_limited'
      ? RATE_LIMITED
      : error.code === 'not_installed'
        ? NOT_INSTALLED
        : error.code === 'not_logged_in'
          ? NOT_LOGGED_IN
          : error.message
  return (
    <div className="helper-notice" role="alert">
      <p>{message}</p>
      {error.code === 'failed' && onRetry && (
        <button type="button" className="small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
