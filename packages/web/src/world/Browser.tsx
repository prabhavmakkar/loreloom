import { useState } from 'react'
import type { Card, CardKind } from '../api.ts'
import { useBook } from '../state/BookContext.tsx'

type Tab = 'place' | 'rule' | 'term'
const TABS: { id: Tab; label: string }[] = [
  { id: 'place', label: 'Places' },
  { id: 'rule', label: 'Rules' },
  { id: 'term', label: 'Glossary' },
]

const byName = (a: Card, b: Card) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** Places, Rules and the Glossary under the map. The glossary reads like a dictionary. */
export function WorldBrowser() {
  const { cards, setWorld } = useBook()
  const [tab, setTab] = useState<Tab>('place')
  const open = (kind: CardKind, id: string) => setWorld({ kind, cardId: id })
  const list = cards[tab]

  return (
    <section className="world-browser" aria-label="World reference">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="count">{cards[t.id].length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="muted">Nothing here yet.</p>}
      {tab === 'term' ? (
        <dl className="glossary">
          {[...list].sort(byName).map((c) => (
            <div key={c.id} className="entry">
              <dt>
                <button type="button" onClick={() => open('term', c.id)}>
                  {c.name}
                </button>
                {typeof c.fields.pronunciation === 'string' && c.fields.pronunciation && <span className="pron">{c.fields.pronunciation}</span>}
              </dt>
              <dd>{c.summary}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <ul className="shelf-list">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => open(tab, c.id)}>
                <span className="shelf-name">{c.name}</span>
                <span className="shelf-summary">{c.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
