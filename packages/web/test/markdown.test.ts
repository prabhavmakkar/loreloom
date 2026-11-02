import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { docToMarkdown, markdownExtensions, markdownToDoc } from '../src/editor/markdown.ts'

const FIXTURE = `Kael pressed his palm to the gate.

"It knows you," [Mira](@character/mira) said, *and he hated that she was right.*

***

## Interlude

**Ashbound** — see [Ashbound](@term/ashbound).`

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(content: string): Editor {
  const editor = new Editor({ extensions: markdownExtensions(), content, contentType: 'markdown' })
  editors.push(editor)
  return editor
}

describe('markdown round trip', () => {
  it('docToMarkdown(markdownToDoc(md)) === md for the fixture', () => {
    expect(docToMarkdown(markdownToDoc(FIXTURE))).toBe(FIXTURE)
  })

  it('parses mentions into mention nodes with kind, id and label', () => {
    const doc = markdownToDoc(FIXTURE)
    const mentions: unknown[] = []
    const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (n.type === 'mention') mentions.push(n.attrs)
      for (const c of (n.content ?? []) as (typeof n)[]) walk(c)
    }
    walk(doc)
    expect(mentions).toEqual([
      { kind: 'character', id: 'mira', label: 'Mira' },
      { kind: 'term', id: 'ashbound', label: 'Ashbound' },
    ])
  })

  it('round-trips through a headless editor', () => {
    const editor = headless(FIXTURE)
    expect(editor.getMarkdown()).toBe(FIXTURE)
    expect(docToMarkdown(editor.getJSON())).toBe(FIXTURE)
  })

  it('serializes an inserted mention as [label](@kind/id)', () => {
    const editor = headless('Hello ')
    editor.commands.focus('end')
    editor.commands.insertContent({ type: 'mention', attrs: { kind: 'place', id: 'ember-gate', label: 'Ember Gate' } })
    expect(editor.getMarkdown()).toBe('Hello [Ember Gate](@place/ember-gate)')
  })

  it('keeps ordinary links as links', () => {
    const md = 'See [the site](https://example.com).'
    expect(docToMarkdown(markdownToDoc(md))).toBe(md)
  })

  it('round-trips the sample chapter style (several paragraphs, many mentions)', () => {
    const md = `The throne room was built of black glass.

"Kneel," said the [Queen](@character/queen). She did not raise her voice.

[Kael](@character/kael) did not kneel. Behind him, [Mira](@character/mira) took a step toward the door.`
    expect(docToMarkdown(markdownToDoc(md))).toBe(md)
  })

  it('an empty document is the empty string', () => {
    expect(docToMarkdown(markdownToDoc(''))).toBe('')
  })
})
