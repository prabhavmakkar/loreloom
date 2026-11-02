import { CARD_KINDS, useBook } from '../state/BookContext.tsx'
import type { CardKind } from '../api.ts'

const SHELVES: Record<CardKind, string> = {
  character: 'Characters',
  place: 'Places',
  rule: 'Rules',
  term: 'Glossary',
}

export function Sidebar() {
  const { chapters, stats, cards, currentChapterId, setCurrentChapterId, setView, view } = useBook()
  const pages = new Map(stats?.perChapter.map((c) => [c.id, c.pages]))
  return (
    <nav className="sidebar" aria-label="Book">
      <h2 className="label">Chapters</h2>
      <ul>
        {chapters.map((c, i) => {
          const p = pages.get(c.id) ?? 0
          const on = c.id === currentChapterId
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`row${on ? ' on' : ''}`}
                aria-current={on ? 'true' : undefined}
                onClick={() => {
                  setCurrentChapterId(c.id)
                  if (view !== 'write') setView('write')
                }}
              >
                <span className="name">
                  <span className="num">{i + 1}.</span> {c.title}
                </span>
                <span className="count">{p > 0 ? `${p}p` : '—'}</span>
              </button>
            </li>
          )
        })}
        {chapters.length === 0 && <li className="empty">No chapters yet</li>}
      </ul>
      <h2 className="label">World</h2>
      <ul>
        {CARD_KINDS.map((k) => (
          <li key={k}>
            <button type="button" className="row" onClick={() => setView('world')}>
              <span className="name">{SHELVES[k]}</span>
              <span className="count">{cards[k].length}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
