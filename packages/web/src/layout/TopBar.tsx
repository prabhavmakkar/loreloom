import { useEffect, useRef, useState } from 'react'
import * as api from '../api.ts'
import type { SaveState } from '../editor/Editor.tsx'
import { formatSaveStatus } from '../save/saveQueue.ts'
import { useBook } from '../state/BookContext.tsx'
import type { View } from '../state/BookContext.tsx'

type Theme = 'light' | 'dark'
const THEME_KEY = 'loreloom-theme'

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const attr = document.documentElement.dataset.theme
    return attr === 'dark' || attr === 'light' ? attr : systemTheme()
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const toggle = () =>
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        // storage unavailable
      }
      return next
    })
  return [theme, toggle]
}

const VIEWS: { id: View; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'world', label: 'World' },
  { id: 'chapters', label: 'Chapters' },
]

/** Re-renders every 30 s so "N min ago" stays true. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [active])
  return active ? Math.max(now, Date.now()) : now
}

function SaveStatusView({ save }: { save: SaveState | null }) {
  const now = useNow(save?.status.state === 'saved')
  if (!save) return null
  const { status } = save
  const text = formatSaveStatus(status, now)
  if (status.state === 'error') {
    return (
      <button type="button" className="retry" onClick={save.retry} title={status.message}>
        {text}
      </button>
    )
  }
  return <span className={status.state === 'conflict' ? 'conflict' : undefined}>{text}</span>
}

/** The book title; click to rename. Enter or leaving the field saves, Escape cancels, blank is refused. */
function BookTitle() {
  const { meta, refresh } = useBook()
  const [editing, setEditing] = useState<string | null>(null)
  const done = useRef(false) // Enter/Escape already handled; ignore the blur that follows
  const title = meta?.title ?? ''

  const start = () => {
    done.current = false
    setEditing(title)
  }
  const finish = async (save: boolean) => {
    if (done.current || editing === null) return
    done.current = true
    const next = editing.trim()
    setEditing(null)
    if (!save || next === '' || next === title) return
    try {
      await api.updateBook({ title: next })
    } catch {
      // not renamed: the refresh below shows the title on disk again
    }
    await refresh()
  }

  return (
    <h1 className="book-title">
      {editing === null ? (
        <button type="button" className="book-title-button" onClick={start} title="Rename book">
          {title}
        </button>
      ) : (
        <input
          aria-label="Book title"
          value={editing}
          autoFocus
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => void finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void finish(true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              void finish(false)
            }
          }}
        />
      )}
    </h1>
  )
}

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`

export function TopBar({ helperOpen, onToggleHelper, save }: { helperOpen: boolean; onToggleHelper(): void; save: SaveState | null }) {
  const { stats, view, setView } = useBook()
  const [theme, toggleTheme] = useTheme()
  return (
    <header className="topbar">
      <BookTitle />
      {stats && (
        <span className="stats">
          {n(stats.pages, 'page')} · {n(stats.chapters, 'chapter')} · {n(stats.words, 'word')}
        </span>
      )}
      <div id="save-status" className="save-status" aria-live="polite">
        <SaveStatusView save={save} />
      </div>
      <nav className="views" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={v.id === view ? 'on' : ''} aria-current={v.id === view ? 'page' : undefined} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>
      <div className="tools">
        <button type="button" className="icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button type="button" className="icon" onClick={onToggleHelper} aria-pressed={helperOpen} aria-label={helperOpen ? 'Hide helper' : 'Show helper'} title="Toggle helper">
          ✦
        </button>
      </div>
    </header>
  )
}
