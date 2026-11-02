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
    listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>()
    closed = false
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
})
