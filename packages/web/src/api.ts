// Types only: importing values from core or the server would drag Node `fs` into the bundle.
import type { Book, BookChange, BookStats, Card, CardKind, Chapter, Relationship } from '@loreloom/core'
import type { AiErrorCode, AiEvent, AiMode, AiStatus, ReviewCategory, ReviewSuggestion } from '../../server/src/ai/provider.ts'

export type { AiErrorCode, AiEvent, AiMode, AiStatus, ReviewCategory, ReviewSuggestion, BookChange, BookStats, Card, CardKind, Chapter, Relationship }

export type BookMeta = Book['meta']
export type ChapterSummary = Omit<Chapter, 'body'>
export type BookInfo = { exists: false } | { exists: true; meta: BookMeta }

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown) {
    super(`Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

const HEADERS = { 'X-Loreloom': '1' }

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** A write that hangs (say, the browser's connection pool is starved) must fail, so the save queue retries. */
const WRITE_TIMEOUT_MS = 15_000

function writeSignal(method: string, signal?: AbortSignal): AbortSignal | undefined {
  if (method === 'GET' || typeof AbortSignal.timeout !== 'function') return signal
  const timeout = AbortSignal.timeout(WRITE_TIMEOUT_MS)
  return signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : (signal ?? timeout)
}

async function request<T>(method: string, path: string, body?: unknown, callerSignal?: AbortSignal): Promise<T> {
  const signal = writeSignal(method, callerSignal)
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? HEADERS : { ...HEADERS, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  })
  const data = await readBody(res)
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

const enc = encodeURIComponent

// ---- book ----
export const getBook = () => request<BookInfo>('GET', '/book')
export const createBook = (input: { title: string; author: string } | { sample: true }) =>
  request<{ meta: BookMeta }>('POST', '/book', input)
export const updateBook = (patch: Partial<BookMeta>) => request<{ meta: BookMeta }>('PATCH', '/book', patch)
export const getStats = () => request<BookStats>('GET', '/stats')

// ---- chapters ----
export const listChapters = () => request<ChapterSummary[]>('GET', '/chapters')
export const createChapter = (title: string) => request<Chapter>('POST', '/chapters', { title })
export const reorderChapters = (ids: string[]) => request<ChapterSummary[]>('PUT', '/chapters/order', { ids })
export const getChapter = (id: string) => request<Chapter>('GET', `/chapters/${enc(id)}`)
export const saveChapter = (id: string, patch: Partial<Omit<Chapter, 'id' | 'version'>>, baseVersion?: string) =>
  request<Chapter>('PUT', `/chapters/${enc(id)}`, { patch, baseVersion })
export const deleteChapter = (id: string) => request<{ ok: true }>('DELETE', `/chapters/${enc(id)}`)

// ---- cards ----
export const listCards = (kind?: CardKind) => request<Card[]>('GET', kind ? `/cards?kind=${kind}` : '/cards')
export const createCard = (kind: CardKind, input: { name: string; summary?: string; aliases?: string[] }) =>
  request<Card>('POST', `/cards/${kind}`, input)
export const getCard = (kind: CardKind, id: string) => request<Card>('GET', `/cards/${kind}/${enc(id)}`)
export const saveCard = (kind: CardKind, id: string, patch: Partial<Omit<Card, 'kind' | 'id' | 'version'>>, baseVersion?: string) =>
  request<Card>('PUT', `/cards/${kind}/${enc(id)}`, { patch, baseVersion })
export const deleteCard = (kind: CardKind, id: string) => request<{ ok: true }>('DELETE', `/cards/${kind}/${enc(id)}`)
export const addRelationship = (id: string, rel: Relationship) =>
  request<Card>('POST', `/cards/character/${enc(id)}/relationships`, rel)
export const removeRelationship = (id: string, rel: { to: string; kind: string }) =>
  request<Card>('DELETE', `/cards/character/${enc(id)}/relationships`, rel)

// ---- helper (AI) ----
export const aiStatus = () => request<AiStatus>('GET', '/ai/status')
export const cancelAi = (requestId: string) => request<{ ok: true }>('POST', '/ai/cancel', { requestId })
export const clearAiSession = (mode: 'brainstorm') => request<{ ok: true }>('DELETE', `/ai/session/${mode}`)

export interface AiRunBody {
  mode: AiMode
  message: string
  chapterId?: string
  selection?: string
  newConversation?: boolean
}

/** Incremental SSE parser: feed it text chunks, get complete `{event, data}` messages. */
export function createSseParser(onMessage: (event: string, data: string) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    for (;;) {
      const m = /\r\n\r\n|\n\n|\r\r/.exec(buffer)
      if (!m) return
      const block = buffer.slice(0, m.index)
      buffer = buffer.slice(m.index + m[0].length)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split(/\r\n|\n|\r/)) {
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length > 0) onMessage(event, data.join('\n'))
    }
  }
}

/** Runs the helper and calls `onEvent` for each streamed AiEvent. Resolves when the stream ends. */
export async function streamAi(body: AiRunBody, onEvent: (ev: AiEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/ai/run', {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!res.ok || !res.body) throw new ApiError(res.status, await readBody(res))
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const feed = createSseParser((event, data) => {
    if (event !== 'ai') return
    try {
      onEvent(JSON.parse(data) as AiEvent)
    } catch {
      // ignore a malformed frame
    }
  })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    feed(decoder.decode(value, { stream: true }))
  }
  feed(decoder.decode())
}

const SILENT_MS = 60_000

interface Subscriber {
  onChange(c: BookChange): void
  onReconnect?: (() => void) | undefined
}

/**
 * One EventSource for the whole page, shared by every subscriber: browsers allow only about
 * six connections per host, and one stream per subscriber would leave saves stalled.
 */
const subscribers = new Set<Subscriber>()
let shared: { es: EventSource; seenReady: boolean; timer?: ReturnType<typeof setTimeout>; watchdog?: ReturnType<typeof setTimeout> } | null =
  null

function openShared(): void {
  const s: NonNullable<typeof shared> = { es: null as unknown as EventSource, seenReady: false }
  shared = s
  const live = () => shared === s
  const reconnect = (delay: number) => {
    clearTimeout(s.watchdog)
    s.es.close()
    s.timer = setTimeout(connect, delay)
  }
  // The server pings every 25 s; silence for longer means a stale stream (a proxy can keep
  // the browser's side open after the server is gone, with no error at all).
  const alive = () => {
    clearTimeout(s.watchdog)
    s.watchdog = setTimeout(() => reconnect(0), SILENT_MS)
  }
  const connect = () => {
    if (!live()) return
    const es = new EventSource('/api/events')
    s.es = es
    alive()
    es.addEventListener('ready', () => {
      alive()
      if (s.seenReady) for (const sub of [...subscribers]) sub.onReconnect?.()
      s.seenReady = true
    })
    es.addEventListener('ping', alive)
    es.addEventListener('change', (e) => {
      alive()
      let change: BookChange
      try {
        change = JSON.parse((e as MessageEvent<string>).data) as BookChange
      } catch {
        return // ignore a malformed frame
      }
      for (const sub of [...subscribers]) sub.onChange(change)
    })
    // An HTTP error (e.g. a 502 from the dev proxy while the server is down) makes the
    // browser give up for good; reconnect ourselves. Network errors it retries on its own.
    es.addEventListener('error', () => {
      if (live() && es.readyState === EventSource.CLOSED) reconnect(3000)
    })
  }
  connect()
}

function closeShared(): void {
  if (!shared) return
  clearTimeout(shared.timer)
  clearTimeout(shared.watchdog)
  shared.es.close()
  shared = null
}

/**
 * Subscribes to on-disk changes. Returns an unsubscribe function.
 * The browser reconnects silently after a drop; changes made meanwhile are never
 * delivered, so `onReconnect` fires on every `ready` after the first.
 */
export function subscribeChanges(onChange: (c: BookChange) => void, onReconnect?: () => void): () => void {
  const sub: Subscriber = { onChange, onReconnect }
  subscribers.add(sub)
  if (!shared) openShared()
  return () => {
    if (!subscribers.delete(sub)) return
    if (subscribers.size === 0) closeShared()
  }
}
