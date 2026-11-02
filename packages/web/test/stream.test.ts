import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiEvent } from '../src/api.ts'

let script: (emit: (ev: AiEvent) => void, signal?: AbortSignal) => Promise<void> | void = () => {}

vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return {
    ...real,
    streamAi: vi.fn(async (_body: unknown, onEvent: (ev: AiEvent) => void, signal?: AbortSignal) => script(onEvent, signal)),
    cancelAi: vi.fn(async () => ({ ok: true })),
  }
})

const api = await import('../src/api.ts')
const { useAiRun } = await import('../src/helper/stream.ts')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Run = ReturnType<typeof useAiRun>
let root: Root
let host: HTMLDivElement
let current: Run

function Probe() {
  current = useAiRun()
  return null
}

beforeEach(() => {
  host = document.createElement('div')
  root = createRoot(host)
  act(() => root.render(createElement(Probe)))
})
afterEach(() => {
  act(() => root.unmount())
  vi.clearAllMocks()
})

const body = { mode: 'brainstorm' as const, message: 'hi' }

it('concatenates text events and returns to idle on done', async () => {
  script = (emit) => {
    emit({ type: 'start', requestId: 'r1' })
    emit({ type: 'session', sessionId: 's1' })
    emit({ type: 'activity', text: 'Reading world/characters/kael.md' })
    emit({ type: 'text', text: 'Hel' })
    emit({ type: 'text', text: 'lo' })
    emit({ type: 'done' })
  }
  await act(async () => {
    await current.run(body)
  })
  expect(current.text).toBe('Hello')
  expect(current.state).toBe('idle')
  expect(current.activity).toEqual(['Reading world/characters/kael.md'])
  expect(current.error).toBeUndefined()
})

it('reports a rate_limited error', async () => {
  script = (emit) => {
    emit({ type: 'start', requestId: 'r1' })
    emit({ type: 'error', code: 'rate_limited', message: 'limit' })
  }
  await act(async () => {
    await current.run(body)
  })
  expect(current.state).toBe('error')
  expect(current.error?.code).toBe('rate_limited')
})

it('treats a cancelled error as a quiet stop', async () => {
  script = (emit) => {
    emit({ type: 'text', text: 'part' })
    emit({ type: 'error', code: 'cancelled', message: 'stopped' })
  }
  await act(async () => {
    await current.run(body)
  })
  expect(current.state).toBe('idle')
  expect(current.error).toBeUndefined()
})

it('resets text, activity and error on each run', async () => {
  script = (emit) => {
    emit({ type: 'text', text: 'one' })
    emit({ type: 'error', code: 'failed', message: 'boom' })
  }
  await act(async () => {
    await current.run(body)
  })
  script = (emit) => {
    emit({ type: 'text', text: 'two' })
    emit({ type: 'done' })
  }
  await act(async () => {
    await current.run(body)
  })
  expect(current.text).toBe('two')
  expect(current.error).toBeUndefined()
})

it('turns a thrown request failure into a failed error', async () => {
  script = () => {
    throw new Error('network down')
  }
  await act(async () => {
    await current.run(body)
  })
  expect(current.state).toBe('error')
  expect(current.error?.code).toBe('failed')
})

it('cancel aborts the fetch, tells the server and goes idle', async () => {
  let signal: AbortSignal | undefined
  script = (emit, s) => {
    signal = s
    emit({ type: 'start', requestId: 'r9' })
    return new Promise<void>((_, reject) => s?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
  }
  let pending: Promise<unknown> = Promise.resolve()
  act(() => {
    pending = current.run(body)
  })
  expect(current.state).toBe('running')
  await act(async () => {
    current.cancel()
    await pending
  })
  expect(signal?.aborted).toBe(true)
  expect(api.cancelAi).toHaveBeenCalledWith('r9')
  expect(current.state).toBe('idle')
  expect(current.error).toBeUndefined()
})

it('aborts a running request on unmount', async () => {
  let signal: AbortSignal | undefined
  script = (emit, s) => {
    signal = s
    emit({ type: 'start', requestId: 'r7' })
    return new Promise<void>(() => {})
  }
  act(() => {
    void current.run(body)
  })
  act(() => root.unmount())
  expect(signal?.aborted).toBe(true)
  expect(api.cancelAi).toHaveBeenCalledWith('r7')
  root = createRoot(host)
})
