import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorHandle, PassageHighlight } from '../src/editor/handle.ts'
import { markdownExtensions } from '../src/editor/markdown.ts'

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function setup(md: string) {
  const editor = new Editor({ extensions: [...markdownExtensions(), PassageHighlight], content: md, contentType: 'markdown' })
  editors.push(editor)
  return { editor, handle: createEditorHandle(() => editor) }
}

const MD = `First line here.

"It knows you," [Mira](@character/mira) said, *quietly*.`

describe('EditorHandle', () => {
  it('isEditable reports whether text-changing calls will take effect', () => {
    const { editor, handle } = setup(MD)
    expect(handle.isEditable()).toBe(true)
    editor.setEditable(false)
    expect(handle.isEditable()).toBe(false)
    expect(createEditorHandle(() => null).isEditable()).toBe(false)
  })

  it('getPlainText joins paragraphs with a blank line and shows mention labels', () => {
    const { handle } = setup(MD)
    expect(handle.getPlainText()).toBe('First line here.\n\n"It knows you," Mira said, quietly.')
  })

  it('getTextBeforeCursor returns the plain text up to the cursor, or the selection end', () => {
    const { editor, handle } = setup(MD)
    const text = handle.getPlainText()
    const at = text.indexOf('said')
    const pos = editor.state.doc.content.size
    editor.commands.setTextSelection(1 + 'First line'.length)
    expect(handle.getTextBeforeCursor()).toBe('First line')
    editor.commands.setTextSelection({ from: 1, to: 1 + 'First line'.length })
    expect(handle.getTextBeforeCursor()).toBe('First line')
    editor.commands.setTextSelection(pos - 1)
    expect(at).toBeGreaterThan(0)
    expect(handle.getTextBeforeCursor()).toBe(text)
  })

  it('replaceRange uses plain-text offsets and keeps the rest of the Markdown intact', () => {
    const { editor, handle } = setup(MD)
    const text = handle.getPlainText()
    const from = text.indexOf('said')
    handle.replaceRange(from, from + 'said'.length, 'whispered')
    expect(editor.getMarkdown()).toBe(`First line here.

"It knows you," [Mira](@character/mira) whispered, *quietly*.`)
  })

  it('replaceRange over a mention replaces the whole mention', () => {
    const { editor, handle } = setup(MD)
    const text = handle.getPlainText()
    const from = text.indexOf('Mira')
    handle.replaceRange(from, from + 4, 'she')
    expect(editor.getMarkdown()).toContain('"It knows you," she said')
  })

  it('getSelectionText returns the selected plain text', () => {
    const { editor, handle } = setup(MD)
    editor.commands.selectAll()
    expect(handle.getSelectionText()).toBe(handle.getPlainText())
  })

  it('replaceSelection and insertAtCursor accept Markdown', () => {
    const { editor, handle } = setup('Alpha beta.')
    editor.commands.setTextSelection({ from: 7, to: 11 })
    handle.replaceSelection('*gamma*')
    expect(editor.getMarkdown()).toBe('Alpha *gamma*.')
    editor.commands.focus('end')
    handle.insertAtCursor('\n\nA new paragraph.')
    expect(editor.getMarkdown()).toBe('Alpha *gamma*.\n\nA new paragraph.')
  })

  it('changes nothing while the editor is read-only, but still reads', () => {
    const { editor, handle } = setup(MD)
    editor.setEditable(false, false)
    handle.insertAtCursor('X')
    handle.replaceRange(0, 5, 'Y')
    editor.commands.selectAll()
    handle.replaceSelection('Z')
    expect(editor.getMarkdown()).toBe(MD)
    expect(handle.getPlainText()).toContain('First line here.')
    expect(handle.getSelectionText()).toBe(handle.getPlainText())
  })

  it('highlightRange decorates the passage without changing the text', () => {
    const { editor, handle } = setup(MD)
    const text = handle.getPlainText()
    const from = text.indexOf('line')
    handle.highlightRange(from, from + 4)
    const el = editor.view.dom.querySelector('.passage-highlight')
    expect(el?.textContent).toBe('line')
    expect(editor.getMarkdown()).toBe(MD)
  })
})
