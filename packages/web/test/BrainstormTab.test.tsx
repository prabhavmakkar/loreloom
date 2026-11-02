import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiEvent } from '../src/api.ts'

let release: () => void = () => {}
let emitRef: (ev: AiEvent) => void = () => {}

vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return {
    ...real,
    streamAi: vi.fn(
      (_b: unknown, onEvent: (ev: AiEvent) => void) =>
        new Promise<void>((resolve) => {
          emitRef = onEvent
          release = resolve
        }),
    ),
    cancelAi: vi.fn(async () => ({ ok: true })),
    clearAiSession: vi.fn(async () => ({ ok: true })),
  }
})

const { BrainstormTab } = await import('../src/helper/BrainstormTab.tsx')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!

it('New conversation during a reply leaves the transcript empty after the stream ends', async () => {
  act(() => root.render(createElement(BrainstormTab, { bookKey: 'b1', chapterId: 'c1', editor: { current: null } })))
  const box = host.querySelector('textarea')!
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    set.call(box, 'What now?')
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    button('Send').click()
  })
  expect(host.textContent).toContain('What now?')
  await act(async () => {
    emitRef({ type: 'text', text: 'partial reply' })
  })
  await act(async () => {
    button('New conversation').click()
  })
  await act(async () => {
    release()
  })
  expect(host.textContent).not.toContain('What now?')
  expect(host.textContent).not.toContain('partial reply')
  expect(host.querySelectorAll('.msg').length).toBe(0)
})
