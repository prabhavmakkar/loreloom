import { getSchema } from '@tiptap/core'
import type { AnyExtension, JSONContent } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import type { MentionOptions } from '@tiptap/extension-mention'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
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

export interface MarkdownExtensionOptions {
  /** Suggestion config for the `@` popup; the headless parser/serializer doesn't need one. */
  mention?: Partial<MentionOptions>
}

/** Every extension the chapter editor uses. Shared by the live editor and the tests. */
export function markdownExtensions(opts: MarkdownExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      horizontalRule: false,
      underline: false, // not representable in Markdown
      link: { openOnClick: false, autolink: false },
    }),
    SceneBreak,
    CardMention.configure({
      HTMLAttributes: { class: 'mention' },
      // Shown as the bare label, the way it reads in the finished book.
      renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, String(node.attrs.label ?? '')],
      ...opts.mention,
    }),
    Markdown,
  ]
}

let manager: MarkdownManager | null = null
function sharedManager(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: markdownExtensions() })
  return manager
}

/** The ProseMirror schema the editor uses, for callers that need it. */
export const editorSchema = () => getSchema(markdownExtensions())

export function markdownToDoc(md: string): JSONContent {
  return sharedManager().parse(md)
}

export function docToMarkdown(doc: JSONContent): string {
  return sharedManager().serialize(doc)
}
