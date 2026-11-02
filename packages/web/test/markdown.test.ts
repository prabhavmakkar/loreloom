import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { docToMarkdown, isLossyMarkdown, markdownExtensions, markdownToDoc } from '../src/editor/markdown.ts'

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

describe('isLossyMarkdown', () => {
  it.each([
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['an image', 'A ![img](x.png) image.'],
    ['an HTML comment', 'Before.\n\n<!-- TODO: fix -->\n\nAfter.'],
    ['an inline HTML element', 'A <span class="x">word</span> here.'],
    ['an HTML block', '<div>\nblock\n</div>'],
    ['a footnote reference', 'Footnote[^1] here.'],
    ['a footnote definition', '[^1]: The note.'],
  ])('detects %s', (_name, md) => {
    expect(isLossyMarkdown(md)).toBe(true)
  })

  it.each([
    ['the fixture', FIXTURE],
    ['--- for a scene break', 'One.\n\n---\n\nTwo.'],
    ['_x_ and __y__', 'She was _very_ __sure__.'],
    ['* bullets', '* a\n* b'],
    ['renumbered lists', '1. a\n1. b'],
    ['setext headings', 'Title\n=====\n\nText.'],
    ['~~~ fences', '~~~\ncode\n~~~'],
    ['an escaped star', 'a \\* star'],
    ['ampersands and angle brackets', 'Salt & Iron, and a < b > c.'],
    ['an entity', 'Salt &amp; Iron &mdash; again.'],
    ['a bare URL', 'See https://example.com now.'],
    ['an autolink', 'See <https://example.com> now.'],
    ['a reference link', 'Use [the map][m] here.\n\n[m]: https://example.com/map'],
    ['a hard break', 'line one  \nline two'],
    ['an escaped list number', '1999\\. A year to remember.'],
    ['an escaped heading marker', '\\# not a heading'],
    ['blank lines between paragraphs', 'x\n\n\n\ny'],
    ['an empty chapter', ''],
  ])('does not flag %s (normalization only)', (_name, md) => {
    expect(isLossyMarkdown(md)).toBe(false)
  })
})

describe('serializer keeps the text', () => {
  it.each([
    ['Salt & Iron, and a < b > c.', 'Salt & Iron, and a < b > c.'],
    ['1999\\. A year to remember.', '1999\\. A year to remember.'],
    ['\\# not a heading', '\\# not a heading'],
    ['\\> not a quote', '\\> not a quote'],
    ['\\- not a list', '\\- not a list'],
    ['A literal \\<span> tag.', 'A literal \\<span> tag.'],
  ])('%s', (md, expected) => {
    const out = docToMarkdown(markdownToDoc(md))
    expect(out).toBe(expected)
    // and it reads back as the same document
    expect(markdownToDoc(out)).toEqual(markdownToDoc(md))
  })

  it('text typed at the start of a paragraph is escaped, not turned into a list', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1999. A year' }] }] }
    const out = docToMarkdown(doc)
    expect(out).toBe('1999\\. A year')
    expect(markdownToDoc(out)).toEqual(doc)
  })
})

describe('the sample book', () => {
  it('has no chapter that would open read-only', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(__dirname, '../../../sample-book/chapters')
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const body = readFileSync(join(dir, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')
      expect(isLossyMarkdown(body), f).toBe(false)
    }
  })
})
