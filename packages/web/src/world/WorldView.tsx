import { useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../api.ts'
import type { CardKind } from '../api.ts'
import type { SaveState } from '../editor/Editor.tsx'
import { useBook } from '../state/BookContext.tsx'
import { CardEditor } from './CardEditor.tsx'
import { WorldBrowser } from './Browser.tsx'
import { CharacterMap } from './CharacterMap.tsx'

const SHELF_TITLE: Record<CardKind, string> = { character: 'Characters', place: 'Places', rule: 'Rules', term: 'Glossary' }
const NEW_LABEL: Record<CardKind, string> = { character: 'character', place: 'place', rule: 'rule', term: 'term' }

function Shelf({ kind }: { kind: CardKind }) {
  const { cards, setWorld, refresh } = useBook()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const list = cards[kind]

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setError(null)
    try {
      const card = await api.createCard(kind, { name: n })
      setAdding(false)
      setName('')
      await refresh()
      setWorld({ kind, cardId: card.id })
    } catch {
      setError('Could not create that card.')
    }
  }

  return (
    <section className="board" aria-label={SHELF_TITLE[kind]}>
      <header className="board-head">
        <h1>{SHELF_TITLE[kind]}</h1>
        {adding ? (
          <form className="inline-form" onSubmit={(e) => void create(e)}>
            <input aria-label={`New ${NEW_LABEL[kind]} name`} autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="primary small" disabled={!name.trim()}>
              Create
            </button>
            <button type="button" className="ghost small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="primary small" onClick={() => setAdding(true)}>
            + New
          </button>
        )}
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {list.length === 0 && <p className="muted">Nothing here yet.</p>}
      <ul className="shelf-list">
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setWorld({ kind, cardId: c.id })}>
              <span className="shelf-name">{c.name}</span>
              <span className="shelf-summary">{c.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MapPage() {
  const { cards, setWorld, refresh } = useBook()
  return (
    <div className="map-page">
      <CharacterMap characters={cards.character} onOpen={(id) => setWorld({ kind: 'character', cardId: id })} onChanged={refresh} />
      <WorldBrowser />
    </div>
  )
}

/** The World view: the character map with the world browser, a shelf's card list, or one open card. */
export function WorldView({ onSaveState }: { onSaveState(s: SaveState | null): void }) {
  const { world, setWorld } = useBook()
  if (!world.kind) return <MapPage />
  const { kind, cardId } = world
  if (!cardId) return <Shelf kind={kind} />
  return (
    <div className="card-page">
      <button type="button" className="ghost small back" onClick={() => setWorld({ kind, cardId: null })}>
        ← {SHELF_TITLE[kind]}
      </button>
      <CardEditor key={`${kind}:${cardId}`} kind={kind} id={cardId} onSaveState={onSaveState} onGone={() => setWorld({ kind, cardId: null })} />
    </div>
  )
}
