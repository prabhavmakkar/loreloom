import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chapter = { id: 'one', title: 'One', order: 1, status: 'drafting', summary: '', body: 'Kael pressed his palm to the gate.', version: 'v1' }

vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return {
    ...real,
    getChapter: vi.fn(async () => ({ ...chapter })),
    saveChapter: vi.fn(async () => ({ ...chapter, version: 'v2' })),
    subscribeChanges: vi.fn(() => () => {}),
  }
})
vi.mock('../src/state/BookContext.tsx', () => ({
  CARD_KINDS: ['character', 'place', 'rule', 'term'],
  useBook: () => ({ cards: { character: [], place: [], rule: [], term: [] } }),
}))

const api = await import('../src/api.ts')
const { Editor } = await import('../src/editor/Editor.tsx')

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

describe('<Editor>', () => {
  it('opening a chapter (StrictMode double mount) never saves or stores a draft', async () => {
    act(() =>
      root.render(
        <StrictMode>
          <Editor key="one" chapterId="one" />
        </StrictMode>,
      ),
    )
    await settle()
    expect(host.querySelector('.prose-editor')?.textContent).toBe(chapter.body)
    expect(host.textContent).not.toContain('Restored unsaved changes')
    expect(localStorage.getItem('loreloom:unsaved:chapter:one')).toBeNull()
    act(() => root.render(<StrictMode>{null}</StrictMode>))
    await settle()
    expect(api.saveChapter).not.toHaveBeenCalled()
    expect(localStorage.getItem('loreloom:unsaved:chapter:one')).toBeNull()
  })

  it('restores a draft left in storage and shows the notice', async () => {
    localStorage.setItem('loreloom:unsaved:chapter:one', JSON.stringify({ value: { body: 'Lost words.', base: 'v1' }, at: Date.now() }))
    act(() => root.render(<Editor key="one" chapterId="one" />))
    await settle()
    expect(host.querySelector('.prose-editor')?.textContent).toBe('Lost words.')
    expect(host.textContent).toContain('Restored unsaved changes from')
    expect(api.saveChapter).toHaveBeenCalledWith('one', { body: 'Lost words.' }, 'v1')
  })

  it('a draft written on an older version saves against that version, so the server can refuse it (409)', async () => {
    localStorage.setItem('loreloom:unsaved:chapter:one', JSON.stringify({ value: { body: 'Old draft.', base: 'v0' }, at: Date.now() }))
    vi.mocked(api.saveChapter).mockRejectedValueOnce(new api.ApiError(409, { error: 'conflict', current: { ...chapter } }))
    act(() => root.render(<Editor key="one" chapterId="one" />))
    await settle()
    expect(api.saveChapter).toHaveBeenCalledWith('one', { body: 'Old draft.' }, 'v0')
    expect(host.textContent).toContain('This chapter changed outside Loreloom.')
    expect(localStorage.getItem('loreloom:unsaved:chapter:one')).not.toBeNull()
  })
})
