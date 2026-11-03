import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const card = { kind: 'term' as const, id: 'x', name: 'Xyl', aliases: [], summary: '', body: 'old', relationships: [], fields: {}, version: 'v1' }

vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return {
    ...real,
    getCard: vi.fn(async () => ({ ...card })),
    saveCard: vi.fn(async () => ({ ...card, version: 'v2' })),
    deleteCard: vi.fn(async () => {
      throw new Error('down')
    }),
    subscribeChanges: vi.fn(() => () => {}),
  }
})
vi.mock('../src/state/BookContext.tsx', () => ({
  CARD_KINDS: ['character', 'place', 'rule', 'term'],
  useBook: () => ({ bookId: 'b1', cards: { character: [], place: [], rule: [], term: [] }, refresh: async () => {}, refreshSoon: () => {} }),
}))

const api = await import('../src/api.ts')
const { CardEditor } = await import('../src/world/CardEditor.tsx')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))))

it('a failed delete keeps the unsaved draft and shows an error', async () => {
  const onGone = vi.fn()
  act(() => root.render(<CardEditor kind="term" id="x" onGone={onGone} />))
  await settle()
  const body = host.querySelector<HTMLTextAreaElement>('#card-body')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'new text')
    body.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const click = (el: Element | undefined) => act(async () => void el?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await click([...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Delete')))
  await click(host.querySelector('.dialog .danger') ?? document.querySelector('.dialog .danger') ?? undefined)
  await settle()
  expect(api.deleteCard).toHaveBeenCalled()
  expect(onGone).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Could not delete')
  expect(JSON.parse(localStorage.getItem('loreloom:unsaved:b1:card:term:x')!).value.body).toBe('new text')
})

it('keeps edits made while the name is blank, and never saves a blank name', async () => {
  act(() => root.render(<CardEditor kind="term" id="x" onGone={() => {}} />))
  await settle()
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
    act(async () => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await setValue(host.querySelector<HTMLInputElement>('.card-name')!, '')
  await setValue(host.querySelector<HTMLTextAreaElement>('#card-body')!, 'typed while nameless')
  expect(JSON.parse(localStorage.getItem('loreloom:unsaved:b1:card:term:x')!).value.body).toBe('typed while nameless')
  act(() => root.unmount())
  await settle()
  expect(api.saveCard).toHaveBeenCalled()
  const patch = vi.mocked(api.saveCard).mock.calls.at(-1)![2]
  expect(patch.body).toBe('typed while nameless')
  expect('name' in patch).toBe(false)
  root = createRoot(host) // afterEach unmounts again
})
