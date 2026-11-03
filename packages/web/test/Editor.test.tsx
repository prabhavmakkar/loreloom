import { act, createRef, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chapter = { id: 'one', title: 'One', order: 1, status: 'drafting' as const, summary: '', body: 'Kael pressed his palm to the gate.', version: 'v1' }

vi.mock('../src/api.ts', async (orig) => {
  const real = await orig<typeof import('../src/api.ts')>()
  return {
    ...real,
    getChapter: vi.fn(async () => ({ ...chapter })),
    saveChapter: vi.fn(async () => ({ ...chapter, version: 'v2' })),
    subscribeChanges: vi.fn(() => () => {}),
  }
})
const refreshSoon = vi.fn()
vi.mock('../src/state/BookContext.tsx', () => ({
  CARD_KINDS: ['character', 'place', 'rule', 'term'],
  useBook: () => ({ bookId: 'b1', cards: { character: [], place: [], rule: [], term: [] }, refreshSoon }),
}))

const api = await import('../src/api.ts')
const { Editor, READ_ONLY_NOTICE } = await import('../src/editor/Editor.tsx')
type EditorHandle = import('../src/editor/Editor.tsx').EditorHandle

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
  it("never restores another book's unsaved draft", async () => {
    localStorage.setItem('loreloom:unsaved:other-book:chapter:one', JSON.stringify({ value: { body: 'Sample draft.', base: 'v1' }, at: Date.now() }))
    act(() => root.render(<Editor key="one" chapterId="one" />))
    await settle()
    expect(host.querySelector('.prose-editor')?.textContent).toBe(chapter.body)
    expect(host.textContent).not.toContain('Restored unsaved changes')
  })

  it('explains a chapter whose header cannot be read', async () => {
    vi.mocked(api.getChapter).mockRejectedValueOnce(new api.ApiError(400, { error: 'invalid', message: "The header (frontmatter) can't be read" }))
    act(() => root.render(<Editor key="one" chapterId="one" />))
    await settle()
    expect(host.textContent).toContain("This chapter's header can't be read; fix it in a text editor.")
  })

  it('asks the book for a refresh after a successful save, so the word count follows the writing', async () => {
    const ref = createRef<EditorHandle>()
    act(() => root.render(<Editor key="one" ref={ref} chapterId="one" />))
    await settle()
    act(() => ref.current!.insertAtCursor('More words.'))
    expect(refreshSoon).not.toHaveBeenCalled()
    // the save lands after the queue's debounce; poll so a loaded test run doesn't flake
    for (let t = 0; t < 60 && !vi.mocked(api.saveChapter).mock.calls.length; t++) await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
    await settle()
    expect(api.saveChapter).toHaveBeenCalled()
    expect(refreshSoon).toHaveBeenCalled()
  })

  it('opens a chapter with content it cannot represent read-only, and never saves it', async () => {
    const lossy = 'Kael.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<!-- TODO -->'
    vi.mocked(api.getChapter).mockResolvedValueOnce({ ...chapter, body: lossy })
    // even a leftover draft must not be restored or saved over it
    localStorage.setItem('loreloom:unsaved:b1:chapter:one', JSON.stringify({ value: { body: 'Draft.', base: 'v1' }, at: Date.now() }))
    const ref = createRef<EditorHandle>()
    act(() => root.render(<Editor key="one" ref={ref} chapterId="one" />))
    await settle()
    const pm = host.querySelector('.prose-editor')!
    expect(pm.getAttribute('contenteditable')).toBe('false')
    expect(host.textContent).toContain(READ_ONLY_NOTICE)
    expect(host.textContent).not.toContain('Restored unsaved changes')
    act(() => ref.current!.insertAtCursor('Helper text.'))
    await act(async () => void (await new Promise((r) => setTimeout(r, 1500))))
    act(() => root.render(null))
    await settle()
    expect(api.saveChapter).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('loreloom:unsaved:b1:chapter:one')!).value.body).toBe('Draft.')
  })

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
    expect(localStorage.getItem('loreloom:unsaved:b1:chapter:one')).toBeNull()
    act(() => root.render(<StrictMode>{null}</StrictMode>))
    await settle()
    expect(api.saveChapter).not.toHaveBeenCalled()
    expect(localStorage.getItem('loreloom:unsaved:b1:chapter:one')).toBeNull()
  })

  it('restores a draft left in storage and shows the notice', async () => {
    localStorage.setItem('loreloom:unsaved:b1:chapter:one', JSON.stringify({ value: { body: 'Lost words.', base: 'v1' }, at: Date.now() }))
    act(() => root.render(<Editor key="one" chapterId="one" />))
    await settle()
    expect(host.querySelector('.prose-editor')?.textContent).toBe('Lost words.')
    expect(host.textContent).toContain('Restored unsaved changes from')
    expect(api.saveChapter).toHaveBeenCalledWith('one', { body: 'Lost words.' }, 'v1')
  })

  it('a draft written on an older version saves against that version, so the server can refuse it (409)', async () => {
    localStorage.setItem('loreloom:unsaved:b1:chapter:one', JSON.stringify({ value: { body: 'Old draft.', base: 'v0' }, at: Date.now() }))
    vi.mocked(api.saveChapter).mockRejectedValueOnce(new api.ApiError(409, { error: 'conflict', current: { ...chapter } }))
    act(() => root.render(<Editor key="one" chapterId="one" />))
    await settle()
    expect(api.saveChapter).toHaveBeenCalledWith('one', { body: 'Old draft.' }, 'v0')
    expect(host.textContent).toContain('This chapter changed outside Loreloom.')
    expect(localStorage.getItem('loreloom:unsaved:b1:chapter:one')).not.toBeNull()
  })
})
