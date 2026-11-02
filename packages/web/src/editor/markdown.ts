import { Extension, getSchema } from '@tiptap/core'
import type { AnyExtension, JSONContent, MarkdownRendererHelpers, RenderContext } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import type { MentionOptions } from '@tiptap/extension-mention'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Paragraph from '@tiptap/extension-paragraph'
import { Markdown, MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import type { CardKind } from '../api.ts'

export interface MentionAttrs {
  kind: CardKind
  id: string
  label: string
}

/** `[Label](@kind/id)` — the same shape the server's MENTION_RE reads. */
const MENTION_AT_START = /^\[([^\]\n]*)\]\(@(character|place|rule|term)\/([^)\s]+)\)/

/** Labels can't contain brackets without breaking the link syntax, so drop them. */
export const cleanLabel = (label: string) => label.replace(/[[\]\n]/g, '').trim()

/**
 * A card mention: an atomic inline node with `{kind, id, label}` that reads and writes
 * `[label](@kind/id)`. Its tokenizer runs before the built-in link rule.
 */
export const CardMention = Mention.extend({
  addAttributes() {
    return {
      kind: { default: 'character', parseHTML: (el) => el.getAttribute('data-kind'), renderHTML: (a) => ({ 'data-kind': a.kind }) },
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label'), renderHTML: (a) => ({ 'data-label': a.label }) },
    }
  },
  markdownTokenName: 'cardMention',
  markdownTokenizer: {
    name: 'cardMention',
    level: 'inline',
    start: (src: string) => src.search(/\[[^\]\n]*\]\(@/),
    tokenize: (src: string) => {
      const m = MENTION_AT_START.exec(src)
      if (!m) return undefined
      return { type: 'cardMention', raw: m[0], label: m[1], kind: m[2], id: m[3] }
    },
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode('mention', { label: String(token.label ?? ''), kind: String(token.kind), id: String(token.id) }),
  renderMarkdown: (node) => {
    const a = (node.attrs ?? {}) as Partial<MentionAttrs>
    return `[${cleanLabel(a.label ?? '')}](@${a.kind}/${a.id})`
  },
  renderText: ({ node }) => String(node.attrs.label ?? ''),
})

/** Scene breaks are written `***`, which is how the sample book and most novelists write them. */
const SceneBreak = HorizontalRule.extend({ renderMarkdown: () => '***' })

// ---- safer serialization --------------------------------------------------------------

/**
 * Text escaping that keeps the author's file readable: the stock serializer writes every
 * `&`, `<` and `>` as an HTML entity. Only escape what would otherwise change meaning.
 */
function escapeText(text: string): string {
  return text
    .replace(/([\\`*_[\]~])/g, '\\$1')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;') // would read as an entity
    .replace(/<(?=[A-Za-z/!?])/g, '\\<') // would read as HTML or an autolink
}

type TextEncoder = (text: string, node: JSONContent, parent?: JSONContent) => string
const isCode = (node: JSONContent, parent?: JSONContent) =>
  parent?.type === 'codeBlock' || (node.marks ?? []).some((m) => (typeof m === 'string' ? m : m.type) === 'code')

/** Swaps in `escapeText` (the method is private in the typings, hence the cast). */
export function useSaferTextEscapes(manager: MarkdownManager): MarkdownManager {
  ;(manager as unknown as { encodeTextForMarkdown: TextEncoder }).encodeTextForMarkdown = (text, node, parent) =>
    isCode(node, parent) ? text : escapeText(text)
  return manager
}

/** Applies `useSaferTextEscapes` to the editor's own manager, so `getMarkdown()` agrees. */
const SaferTextEscapes = Extension.create({
  name: 'saferTextEscapes',
  onBeforeCreate() {
    if (this.editor.markdown) useSaferTextEscapes(this.editor.markdown)
  },
})

/**
 * Text at the start of a paragraph line that Markdown would read as a heading, quote, list,
 * rule or code block. The stock serializer doesn't escape these, so "1999. A year" came
 * back as a numbered list.
 */
export function escapeLineStarts(md: string): string {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/^[ \t]+/, '') // 4+ leading spaces would be a code block; they never show anyway
        .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
        .replace(/^>/, '\\>')
        .replace(/^([-+])(?=\s|$)/, '\\$1')
        .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
        .replace(/^([=-]+)(\s*)$/, '\\$1$2'),
    )
    .join('\n')
}

type RenderMd = (node: JSONContent, h: MarkdownRendererHelpers, ctx?: RenderContext) => string
const stockParagraphRender = Paragraph.config.renderMarkdown as RenderMd

const BookParagraph = Paragraph.extend({
  renderMarkdown: (node: JSONContent, h: MarkdownRendererHelpers, ctx?: RenderContext) =>
    escapeLineStarts(stockParagraphRender(node, h, ctx)),
})

export interface MarkdownExtensionOptions {
  /** Suggestion config for the `@` popup; the headless parser/serializer doesn't need one. */
  mention?: Partial<MentionOptions>
}

/** Every extension the chapter editor uses. Shared by the live editor and the tests. */
export function markdownExtensions(opts: MarkdownExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      paragraph: false,
      horizontalRule: false,
      underline: false, // not representable in Markdown
      link: { openOnClick: false, autolink: false },
    }),
    BookParagraph,
    SceneBreak,
    CardMention.configure({
      HTMLAttributes: { class: 'mention' },
      // Shown as the bare label, the way it reads in the finished book.
      renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, String(node.attrs.label ?? '')],
      ...opts.mention,
    }),
    Markdown,
    SaferTextEscapes, // after Markdown: it patches the manager Markdown creates
  ]
}

let manager: MarkdownManager | null = null
function sharedManager(): MarkdownManager {
  manager ??= useSaferTextEscapes(new MarkdownManager({ extensions: markdownExtensions() }))
  return manager
}

/** The ProseMirror schema the editor uses, for callers that need it. */
export const editorSchema = () => getSchema(markdownExtensions())

/** Text nodes keep named entities like `&mdash;` verbatim; decode them (outside code). */
function decodeTextEntities(n: JSONContent, inCode = false): JSONContent {
  const code = inCode || n.type === 'codeBlock'
  if (n.type === 'text' && !code && !(n.marks ?? []).some((m) => m.type === 'code') && n.text?.includes('&')) {
    return { ...n, text: decodeEntities(n.text) }
  }
  return n.content ? { ...n, content: n.content.map((c) => decodeTextEntities(c, code)) } : n
}

export function markdownToDoc(md: string): JSONContent {
  return decodeTextEntities(sharedManager().parse(md))
}

export function docToMarkdown(doc: JSONContent): string {
  return sharedManager().serialize(doc)
}

// ---- loss detection ---------------------------------------------------------------------

/** Footnotes aren't in the schema; their syntax would come back escaped and broken. */
const FOOTNOTE = /\[\^[^\]\n]+\]/

function decodeEntities(s: string): string {
  if (typeof document === 'undefined') return s
  const el = document.createElement('textarea')
  return s.replace(/&#?[A-Za-z0-9]+;/g, (m) => {
    el.innerHTML = m
    return el.value
  })
}

/**
 * The characters a reader can see, as a sorted multiset. Markup that is pure formatting
 * (emphasis, markers, escapes, list numbering, link brackets, whitespace) is ignored, and
 * so is order, which reference links change.
 */
function visibleChars(md: string): string {
  const s = decodeEntities(md)
    .replace(/^[ ]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?.*$/gm, '$1') // reference definition: keep the URL
    .replace(/\]\[[^\]\n]*\]/g, ']') // [text][label]
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1') // <autolink>
    .replace(/\[([^\]\n]+)\]\(\1\)/g, '$1') // [url](url), how bare URLs come back
    .replace(/^[ \t]*\d{1,9}[.)](?=\s)/gm, '') // list numbers get renumbered
    .replace(/[\s\\*_~#>\-+=|[\]()!`:]/g, '')
  return [...s].sort().join('')
}

/** A link whose text is its own URL is how a bare URL round-trips; treat it as text. */
function canonical(doc: JSONContent): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    const out: JSONContent = { ...n }
    if (n.marks) {
      const marks = n.marks.filter((m) => !(m.type === 'link' && n.text !== undefined && String(m.attrs?.href ?? '').replace(/^mailto:/, '') === n.text))
      if (marks.length) out.marks = marks
      else delete out.marks
    }
    if (n.content) {
      const merged: JSONContent[] = []
      for (const c of n.content.map(walk)) {
        const prev = merged[merged.length - 1]
        if (prev?.type === 'text' && c.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(c.marks ?? [])) {
          merged[merged.length - 1] = { ...prev, text: (prev.text ?? '') + (c.text ?? '') }
        } else merged.push(c)
      }
      out.content = merged
    }
    return out
  }
  return walk(doc)
}

/**
 * Whether editing this Markdown would lose something: content the schema can't hold
 * (tables, images, HTML, footnotes…), or output that wouldn't read back the same.
 * Pure normalization (`---`→`***`, `_x_`→`*x*`, escapes, list markers) is not loss.
 */
export function isLossyMarkdown(md: string): boolean {
  if (FOOTNOTE.test(md)) return true
  const doc = markdownToDoc(md)
  const out = docToMarkdown(doc)
  if (visibleChars(md) !== visibleChars(out)) return true
  return JSON.stringify(canonical(markdownToDoc(out))) !== JSON.stringify(canonical(doc))
}
