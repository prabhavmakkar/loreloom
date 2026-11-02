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

const { ReviewTab } = await import('../src/helper/ReviewTab.tsx')
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

it('re-finds the passage on Apply and disables the card once applied or missing', async () => {
  let text = 'He ran. Kael melted the lock.'
  const replaceRange = vi.fn((from: number, to: number, fix: string) => {
    text = text.slice(0, from) + fix + text.slice(to)
  })
  const editor = { current: { getPlainText: () => text, getSelectionText: () => '', replaceRange, highlightRange: vi.fn() } }
  act(() => root.render(createElement(ReviewTab, { chapterId: 'c1', editor: editor as never })))
  await act(async () => button('Review chapter').click())
  await act(async () => {
    emit({ type: 'suggestion', suggestion: { id: 'r1', quote: 'Kael melted the lock.', issue: 'Iron repels ember-magic', fix: 'Kael picked the lock.', category: 'continuity' } })
    emit({ type: 'suggestion', suggestion: { id: 'r2', quote: 'He ran.', issue: 'Flat', fix: '', category: 'prose' } })
    release()
  })
  expect([...host.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Continuity', 'Prose'])

  text = text.replace('He ran. ', '') // the author edited the passage away meanwhile
  const [applyA, applyB] = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Apply')
  await act(async () => applyA!.click())
  expect(replaceRange).toHaveBeenCalledWith(0, 21, 'Kael picked the lock.')
  expect(button('Applied').hasAttribute('disabled')).toBe(true)
  await act(async () => applyB!.click())
  expect(replaceRange).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain("Can't find this passage anymore")
  expect(applyB!.hasAttribute('disabled')).toBe(true)

  await act(async () => button('Dismiss').click())
  expect(host.querySelectorAll('article')).toHaveLength(1)
})
