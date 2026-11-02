import { Extension } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { markdownToDoc } from './markdown.ts'

/**
 * What the helper (Tasks 10–11) may do to the chapter. Every call comes from an explicit
 * author click. `from`/`to` are offsets into `getPlainText()`.
 */
export interface EditorHandle {
  insertAtCursor(text: string): void
  replaceSelection(text: string): void
  getSelectionText(): string
  highlightRange(from: number, to: number): void
  replaceRange(from: number, to: number, text: string): void
  getPlainText(): string
}

interface Segment {
  start: number // offset in the plain text
  end: number
  pos: number // document position
  atom: boolean // a mention: one node, not addressable inside
  size: number
}

const BLOCK_SEP = '\n\n'
const leafText = (node: PMNode) => (node.type.name === 'mention' ? String(node.attrs.label ?? '') : node.type.name === 'hardBreak' ? '\n' : '')

/** The chapter as plain text (paragraphs separated by a blank line), with a map back to positions. */
export function plainTextMap(doc: PMNode): { text: string; segments: Segment[] } {
  let text = ''
  let blocks = 0
  const segments: Segment[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (blocks++ > 0) text += BLOCK_SEP
      return true
    }
    if (node.isText || node.type.name === 'mention') {
      const t = node.isText ? node.text! : leafText(node)
      segments.push({ start: text.length, end: text.length + t.length, pos, atom: !node.isText, size: node.nodeSize })
      text += t
      return false
    }
    if (node.isInline && node.isLeaf) {
      text += leafText(node)
      return false
    }
    return true
  })
  return { text, segments }
}

/** Maps a plain-text offset to a document position. A range never splits a mention. */
export function positionAt(segments: Segment[], offset: number, side: 'start' | 'end', docEnd: number): number {
  let prevEnd: number | null = null
  for (const s of segments) {
    if (offset < s.start) return side === 'end' && prevEnd !== null ? prevEnd : s.pos
    if (offset <= s.end) {
      if (!s.atom) return s.pos + (offset - s.start)
      if (side === 'start') return offset === s.end ? s.pos + s.size : s.pos
      return offset === s.start ? s.pos : s.pos + s.size
    }
    prevEnd = s.pos + s.size
  }
  return prevEnd ?? Math.max(0, docEnd - 1)
}

const highlightKey = new PluginKey<DecorationSet>('loreloomHighlight')

/** A passage highlight the helper can set; it clears itself on the next edit. */
export const PassageHighlight = Extension.create({
  name: 'passageHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(highlightKey) as { from: number; to: number } | null | undefined
            if (meta === null) return DecorationSet.empty
            if (meta) return DecorationSet.create(tr.doc, [Decoration.inline(meta.from, meta.to, { class: 'passage-highlight' })])
            return tr.docChanged ? DecorationSet.empty : set
          },
        },
        props: { decorations: (state) => highlightKey.getState(state) },
      }),
    ]
  },
})

function range(editor: Editor, from: number, to: number) {
  const { segments } = plainTextMap(editor.state.doc)
  const end = editor.state.doc.content.size
  const a = positionAt(segments, Math.min(from, to), 'start', end)
  const b = positionAt(segments, Math.max(from, to), 'end', end)
  return { from: a, to: Math.max(a, b) }
}

/**
 * Markdown to insert: a single line becomes inline content (so it joins the paragraph
 * it lands in); anything with blank lines becomes paragraphs.
 */
function toContent(text: string): JSONContent[] {
  const blocks = markdownToDoc(text.trim()).content ?? []
  const only = blocks[0]
  if (blocks.length === 1 && only?.type === 'paragraph' && !/\n\s*\n/.test(text)) return only.content ?? []
  return blocks
}

/**
 * Builds the handle over whichever editor instance is current. Calls are no-ops before it
 * exists, and the ones that change text are no-ops while it is read-only.
 */
export function createEditorHandle(getEditor: () => Editor | null): EditorHandle {
  const get = () => {
    const ed = getEditor()
    return ed && !ed.isDestroyed && ed.isEditable ? ed : null
  }
  const read = () => {
    const ed = getEditor()
    return ed && !ed.isDestroyed ? ed : null
  }
  return {
    insertAtCursor(text) {
      get()?.chain().focus().insertContent(toContent(text)).run()
    },
    replaceSelection(text) {
      const ed = get()
      if (!ed) return
      const { from, to } = ed.state.selection
      ed.chain().focus().insertContentAt({ from, to }, toContent(text)).run()
    },
    getSelectionText() {
      const ed = read()
      if (!ed) return ''
      const { from, to } = ed.state.selection
      return ed.state.doc.textBetween(from, to, BLOCK_SEP, leafText)
    },
    highlightRange(from, to) {
      const ed = read()
      if (!ed) return
      const r = range(ed, from, to)
      const tr = ed.state.tr.setMeta(highlightKey, r).setMeta('addToHistory', false)
      ed.view.dispatch(tr)
      ed.view.domAtPos(r.from).node.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    },
    replaceRange(from, to, text) {
      const ed = get()
      if (!ed) return
      ed.chain().focus().insertContentAt(range(ed, from, to), toContent(text)).run()
    },
    getPlainText() {
      const ed = read()
      return ed ? plainTextMap(ed.state.doc).text : ''
    },
  }
}
