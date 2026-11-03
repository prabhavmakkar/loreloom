import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const refresh = vi.fn(async () => {})
vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return { ...real, updateBook: vi.fn(async () => ({ meta: { title: 'x', author: '', wordsPerPage: 250 } })) }
})
vi.mock('../src/state/BookContext.tsx', () => ({
  useBook: () => ({ meta: { title: 'Untitled Fantasy Novel', author: '', wordsPerPage: 250 }, stats: null, view: 'write', setView: () => {}, refresh }),
}))

const api = await import('../src/api.ts')
const { TopBar } = await import('../src/layout/TopBar.tsx')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<TopBar helperOpen={false} onToggleHelper={() => {}} save={null} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const startEditing = async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('.book-title button')!.click())
  return host.querySelector<HTMLInputElement>('.book-title input')!
}
const type = (el: HTMLInputElement, v: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const key = (el: HTMLInputElement, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

it('renames the book on Enter and refreshes', async () => {
  const input = await startEditing()
  expect(input.value).toBe('Untitled Fantasy Novel')
  await type(input, '  The Ember Gate  ')
  await key(input, 'Enter')
  expect(api.updateBook).toHaveBeenCalledWith({ title: 'The Ember Gate' })
  expect(refresh).toHaveBeenCalled()
  expect(host.querySelector('.book-title input')).toBeNull()
})

it('saves on blur', async () => {
  const input = await startEditing()
  await type(input, 'Salt and Iron')
  await act(async () => input.blur())
  expect(api.updateBook).toHaveBeenCalledWith({ title: 'Salt and Iron' })
})

it('Escape cancels and an empty title is rejected', async () => {
  let input = await startEditing()
  await type(input, 'Nope')
  await key(input, 'Escape')
  expect(host.querySelector('.book-title input')).toBeNull()
  input = await startEditing()
  await type(input, '   ')
  await key(input, 'Enter')
  expect(api.updateBook).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Untitled Fantasy Novel')
})
