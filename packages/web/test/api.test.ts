import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getBook, streamAi, subscribeChanges } from '../src/api.ts'
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

describe('subscribeChanges', () => {
  class FakeEventSource {
    static last: FakeEventSource
    static CLOSED = 2
    listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>()
    closed = false
    readyState = 1
    constructor(public url: string) {
      FakeEventSource.last = this
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
