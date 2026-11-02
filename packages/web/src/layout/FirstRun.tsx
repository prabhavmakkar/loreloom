import { useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../api.ts'
import { useBook } from '../state/BookContext.tsx'

export function FirstRun() {
  const { refresh } = useBook()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(input: Parameters<typeof api.createBook>[0]) {
    setBusy(true)
    setError(null)
    try {
      await api.createBook(input)
      await refresh()
    } catch (err) {
      // 409 book_exists just means another tab got there first.
      if (err instanceof api.ApiError && err.status === 409) await refresh()
      else setError('Could not create the book. Check that the folder is writable, then try again.')
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (title.trim()) void run({ title: title.trim(), author: author.trim() || 'Anonymous' })
  }

  return (
    <div className="firstrun">
      <div className="card">
        <p className="mark" aria-hidden="true">L</p>
        <h1>Loreloom</h1>
        <p className="lede">A quiet place to write your fantasy novel, with your world close at hand.</p>
        {creating ? (
          <form onSubmit={onSubmit}>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Ashen Crown" autoFocus required />
            </label>
            <label>
              Author
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" />
            </label>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy || !title.trim()}>
                Start writing
              </button>
              <button type="button" className="ghost" onClick={() => setCreating(false)} disabled={busy}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New book
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void run({ sample: true })}>
              Open sample book
            </button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <p className="note">
          Your book is plain files in a folder on this computer. Keep that folder in a synced or backed-up location, or in a git repository, so your work is safe.
        </p>
      </div>
    </div>
  )
}
