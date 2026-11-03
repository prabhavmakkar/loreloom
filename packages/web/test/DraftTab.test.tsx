import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiEvent } from '../src/api.ts'

let emit: (ev: AiEvent) => void = () => {}
let release: () => void = () => {}

vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return {
    ...real,
    streamAi: vi.fn(
      (_b: unknown, onEvent: (ev: AiEvent) => void) =>
        new Promise<void>((resolve) => {
          emit = onEvent
          release = resolve
        }),
    ),
    cancelAi: vi.fn(async () => ({ ok: true })),
  }
})
vi.mock('../src/state/BookContext.tsx', () => ({ useBook: () => ({ view: 'write' }) }))

const { DraftTab } = await import('../src/helper/DraftTab.tsx')
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

it('disables Insert and Replace on a read-only chapter', async () => {
  const editor = {
    current: { isEditable: () => false, getSelectionText: () => 'picked', getTextBeforeCursor: () => '', insertAtCursor: vi.fn(), replaceSelection: vi.fn() },
  }
  act(() => root.render(createElement(DraftTab, { chapterId: 'c1', editor: editor as never })))
  await act(async () => button('Draft the next scene').click())
  await act(async () => {
    emit({ type: 'text', text: 'New prose.' })
    emit({ type: 'done' })
    release()
  })
  expect(button('Insert at cursor').hasAttribute('disabled')).toBe(true)
  expect(button('Replace selection').hasAttribute('disabled')).toBe(true)
  expect(button('Copy').hasAttribute('disabled')).toBe(false)
})

it('enables Insert on an editable chapter, and Insert hands the draft to the editor', async () => {
  const insertAtCursor = vi.fn()
  const editor = { current: { isEditable: () => true, getSelectionText: () => '', getTextBeforeCursor: () => '', insertAtCursor, replaceSelection: vi.fn() } }
  act(() => root.render(createElement(DraftTab, { chapterId: 'c1', editor: editor as never })))
  await act(async () => button('Draft the next scene').click())
  await act(async () => {
    emit({ type: 'text', text: 'New prose.' })
    emit({ type: 'done' })
    release()
  })
  expect(button('Insert at cursor').hasAttribute('disabled')).toBe(false)
  await act(async () => button('Insert at cursor').click())
  expect(insertAtCursor).toHaveBeenCalledWith('New prose.')
})
