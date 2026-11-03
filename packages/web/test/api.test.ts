import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getBook, saveChapter, streamAi, subscribeChanges } from '../src/api.ts'
import type { AiEvent } from '../src/api.ts'

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('streamAi', () => {
  it('parses an event split mid-line across two chunks', async () => {
    const fetchMock = vi.fn(async () => streamOf(['event: ai\ndata: {"type":"te', 'xt","text":"Hi"}\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const events: AiEvent[] = []
    await streamAi({ mode: 'brainstorm', message: 'hello' }, (e) => events.push(e))
    expect(events).toEqual([{ type: 'text', text: 'Hi' }])
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>)['X-Loreloom']).toBe('1')
  })

  it('splits between lines and ignores other events and pings', async () => {
    vi.stubGlobal('fetch', async () =>
      streamOf([': ping\n\nevent: ai\n', 'data: {"type":"start","requestId":"r"}\n\nevent: ping\ndata: \n\nevent: ai\ndata: {"type":"done"}\n\n']),
    )
    const events: AiEvent[] = []
    await streamAi({ mode: 'draft', message: 'x' }, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['start', 'done'])
  })
})

describe('request errors', () => {
  it('throws ApiError with status and body', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const err = await getBook().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 403, body: { error: 'forbidden' } })
  })
})

describe('request timeouts', () => {
  it('gives a write a timeout signal so a stalled save fails and retries, but not a read', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await saveChapter('a', { body: 'x' }, 'v1')
    await getBook()
    const [put, get] = fetchMock.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1])
    expect(put!.signal).toBeInstanceOf(AbortSignal)
    expect(get!.signal).toBeUndefined()
  })
})

describe('subscribeChanges', () => {
  class FakeEventSource {
    static last: FakeEventSource
    static created = 0
    static CLOSED = 2
    listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>()
    closed = false
    readyState = 1
    constructor(public url: string) {
      FakeEventSource.last = this
      FakeEventSource.created++
    }
    addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
    }
    emit(type: string, data = '{}') {
      for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent<string>)
    }
    close() {
      this.closed = true
    }
  }

  // Browsers allow ~6 connections per host; one EventSource per subscriber would starve saves.
  it('shares one EventSource between subscribers and closes it after the last unsubscribe', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    FakeEventSource.created = 0
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    const reconnects = [vi.fn(), vi.fn(), vi.fn()]
    const stops = [subscribeChanges(a, reconnects[0]), subscribeChanges(b, reconnects[1]), subscribeChanges(c, reconnects[2])]
    expect(FakeEventSource.created).toBe(1)
    const es = FakeEventSource.last
    es.emit('ready')
    es.emit('change', '{"type":"chapter","id":"a"}')
    for (const fn of [a, b, c]) expect(fn).toHaveBeenCalledWith({ type: 'chapter', id: 'a' })
    es.emit('ready')
    for (const fn of reconnects) expect(fn).toHaveBeenCalledTimes(1)
    stops[0]!()
    stops[1]!()
    expect(es.closed).toBe(false)
    es.emit('change', '{"type":"chapter","id":"b"}')
    expect(a).toHaveBeenCalledTimes(1)
    expect(c).toHaveBeenCalledTimes(2)
    stops[2]!()
    expect(es.closed).toBe(true)
    stops[2]!() // a second call is harmless
    const again = subscribeChanges(() => {})
    expect(FakeEventSource.created).toBe(2)
    again()
  })

  it('calls onChange for change events and onReconnect only for a second ready', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onChange = vi.fn()
    const onReconnect = vi.fn()
    const stop = subscribeChanges(onChange, onReconnect)
    const es = FakeEventSource.last
    es.emit('ready')
    expect(onReconnect).not.toHaveBeenCalled()
    es.emit('change', '{"type":"chapter","id":"a"}')
    expect(onChange).toHaveBeenCalledWith({ type: 'chapter', id: 'a' })
    es.emit('ready')
    expect(onReconnect).toHaveBeenCalledTimes(1)
    stop()
    expect(es.closed).toBe(true)
  })

  // Behind a proxy (vite dev), a down server answers 502 and the browser closes the
  // EventSource for good instead of retrying; changes would then go unnoticed.
  it('reconnects itself when the browser gives up on the stream', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('EventSource', FakeEventSource)
      const onChange = vi.fn()
      const onReconnect = vi.fn()
      const stop = subscribeChanges(onChange, onReconnect)
      const first = FakeEventSource.last
      first.emit('ready')
      first.readyState = FakeEventSource.CLOSED
      first.emit('error')
      vi.advanceTimersByTime(5000)
      const second = FakeEventSource.last
      expect(second).not.toBe(first)
      expect(first.closed).toBe(true)
      second.emit('ready')
      expect(onReconnect).toHaveBeenCalledTimes(1)
      second.emit('change', '{"type":"chapter","id":"b"}')
      expect(onChange).toHaveBeenCalledWith({ type: 'chapter', id: 'b' })

      // a transient error the browser retries itself is left alone
      second.emit('error')
      vi.advanceTimersByTime(5000)
      expect(FakeEventSource.last).toBe(second)

      // stopping cancels a pending reconnect
      second.readyState = FakeEventSource.CLOSED
      second.emit('error')
      stop()
      vi.advanceTimersByTime(5000)
      expect(FakeEventSource.last).toBe(second)
      expect(second.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // A proxy can also leave the browser's side of a dead stream open, with no error at all.
  // The server pings every 25 s, so 60 s of silence means the stream is stale.
  it('reconnects a stream that has gone silent, and pings keep it alive', () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('EventSource', FakeEventSource)
      const onReconnect = vi.fn()
      const stop = subscribeChanges(() => {}, onReconnect)
      const first = FakeEventSource.last
      first.emit('ready')
      vi.advanceTimersByTime(50_000)
      first.emit('ping', '')
      vi.advanceTimersByTime(50_000)
      expect(FakeEventSource.last).toBe(first)
      vi.advanceTimersByTime(10_001)
      const second = FakeEventSource.last
      expect(second).not.toBe(first)
      expect(first.closed).toBe(true)
      second.emit('ready')
      expect(onReconnect).toHaveBeenCalledTimes(1)
      stop()
      vi.advanceTimersByTime(120_000)
      expect(FakeEventSource.last).toBe(second)
    } finally {
      vi.useRealTimers()
    }
  })
})
