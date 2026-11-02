import { ReactRenderer } from '@tiptap/react'
import type { MentionOptions } from '@tiptap/extension-mention'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import type { Card, CardKind } from '../api.ts'
import { CARD_KINDS } from '../state/BookContext.tsx'
import { cleanLabel } from './markdown.ts'
import type { MentionAttrs } from './markdown.ts'

export interface MentionItem extends MentionAttrs {
  /** The card's full name, shown in the list; `label` is what gets written into the text. */
  name: string
}

const KIND_LABEL: Record<CardKind, string> = { character: 'Character', place: 'Place', rule: 'Rule', term: 'Term' }
const MAX_ITEMS = 8

/** True when some word of `text` starts with `query` (case-insensitive). */
function wordPrefix(text: string, query: string): boolean {
  const t = text.toLocaleLowerCase()
  if (t.startsWith(query)) return true
  return t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(query))
}

/**
 * Cards whose name or an alias matches `query`, characters first, then places, rules and terms.
 * The label is the shortest matching name or alias, so `@Mi` writes "Mira", not "Mira Vale".
 */
export function filterCards(cards: Record<CardKind, Card[]>, query: string): MentionItem[] {
  const q = query.trim().toLocaleLowerCase()
  const out: MentionItem[] = []
  for (const kind of CARD_KINDS) {
    for (const card of cards[kind] ?? []) {
      const names = [card.name, ...card.aliases].map(cleanLabel).filter(Boolean)
      const hits = q ? names.filter((n) => wordPrefix(n, q)) : names
      if (hits.length === 0) continue
      const label = hits.reduce((a, b) => (b.length < a.length ? b : a))
      out.push({ kind, id: card.id, label, name: card.name })
      if (out.length >= MAX_ITEMS) return out
    }
  }
  return out
}

interface ListProps {
  items: MentionItem[]
  query: string
  command(item: MentionItem): void
}
interface ListHandle {
  onKeyDown(e: KeyboardEvent): boolean
}

const MentionList = forwardRef<ListHandle, ListProps>(function MentionList({ items, query, command }, ref) {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (items.length === 0) return false
      if (e.key === 'ArrowDown') {
        setActive((i) => (i + 1) % items.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        setActive((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = items[active]
        if (item) command(item)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return <div className="mention-empty">{query ? `No card matches “${query}”` : 'No cards yet'}</div>
  }
  return (
    <ul role="listbox" aria-label="Cards">
      {items.map((item, i) => (
        <li key={`${item.kind}/${item.id}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            className={i === active ? 'on' : ''}
            onMouseEnter={() => setActive(i)}
            // keep focus in the editor
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(item)}
          >
            <span className="mention-name">{item.name}</span>
            {item.label !== item.name && <span className="mention-as">as {item.label}</span>}
            <span className={`mention-kind k-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
          </button>
        </li>
      ))}
    </ul>
  )
})

/** The `@` suggestion: lists every card, filtered by name or alias, in a small popover. */
export function cardSuggestion(getCards: () => Record<CardKind, Card[]>): MentionOptions['suggestion'] {
  return {
    char: '@',
    items: ({ query }) => filterCards(getCards(), query),
    command: ({ editor, range, props }) => {
      const item = props as unknown as MentionItem
      // Swallow a following space so we don't end up with two.
      const next = editor.view.state.selection.$to.nodeAfter
      if (next?.text?.startsWith(' ')) range.to += 1
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { kind: item.kind, id: item.id, label: item.label } },
          { type: 'text', text: ' ' },
        ])
        .run()
    },
    render: () => {
      let renderer: ReactRenderer<ListHandle, ListProps> | null = null
      let unmount: (() => void) | null = null
      const toProps = (p: SuggestionProps<MentionItem>): ListProps => ({
        items: p.items,
        query: p.query,
        command: (item) => p.command(item as never),
      })
      return {
        onStart: (p: SuggestionProps<MentionItem>) => {
          renderer = new ReactRenderer(MentionList, { props: toProps(p), editor: p.editor, className: 'mention-popover' })
          unmount = p.mount(renderer.element)
        },
        onUpdate: (p: SuggestionProps<MentionItem>) => renderer?.updateProps(toProps(p)),
        onKeyDown: ({ event }: SuggestionKeyDownProps) => {
          if (event.key === 'Escape') return false
          return renderer?.ref?.onKeyDown(event) ?? false
        },
        onExit: () => {
          unmount?.()
          renderer?.destroy()
          renderer = null
          unmount = null
        },
      }
    },
  }
}
