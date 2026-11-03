import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as api from '../api.ts'
import type { Card, CardKind, Relationship } from '../api.ts'
import type { SaveState } from '../editor/Editor.tsx'
import { createSaveQueue, restoreUnsaved } from '../save/saveQueue.ts'
import type { SaveQueue } from '../save/saveQueue.ts'
import { useBook } from '../state/BookContext.tsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'

/** The editable part of a card, plus the on-disk version it was written on top of. */
interface Draft {
  name: string
  aliases: string[]
  summary: string
  body: string
  role: string
  pronunciation: string
  base: string
}

const KIND_LABEL: Record<CardKind, string> = { character: 'Character', place: 'Place', rule: 'Rule', term: 'Glossary term' }

// ---- page-wide safety net (the card twin of the one in Editor.tsx) -------------------------
// Duplicated on purpose: sharing it would mean changing the chapter editor's wiring.

const liveQueues = new Set<SaveQueue<Draft>>()
/** A card's pending final save; reopening that card waits for it. */
const closing = new Map<string, Promise<void>>()
let reporter: object | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if ([...liveQueues].some((q) => q.hasUnsaved())) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') for (const q of liveQueues) void q.flush()
  })
}

function localStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    return window.localStorage
  } catch {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }
}

const isCard = (v: unknown): v is Card =>
  !!v && typeof v === 'object' && typeof (v as Card).body === 'string' && typeof (v as Card).version === 'string'

function conflictOf(err: unknown): Card | null {
  if (!(err instanceof api.ApiError) || err.status !== 409) return null
  const current = (err.body as { current?: unknown } | null)?.current
  return isCard(current) ? current : null
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function draftOf(card: Card): Omit<Draft, 'base'> {
  return {
    name: card.name,
    aliases: card.aliases,
    summary: card.summary,
    body: card.body,
    role: str(card.fields.role),
    pronunciation: str(card.fields.pronunciation),
  }
}

function sameDraft(a: Omit<Draft, 'base'>, b: Omit<Draft, 'base'>): boolean {
  return a.name === b.name && a.summary === b.summary && a.body === b.body && a.role === b.role && a.pronunciation === b.pronunciation && a.aliases.join('\n') === b.aliases.join('\n')
}

/** Extra frontmatter is kept as it was; only role and pronunciation are ours to change. */
function fieldsFor(kind: CardKind, base: Record<string, unknown>, d: Draft): Record<string, unknown> {
  const fields = { ...base }
  const set = (k: string, v: string) => (v.trim() ? (fields[k] = v) : delete fields[k])
  if (kind === 'character') set('role', d.role)
  if (kind === 'term') set('pronunciation', d.pronunciation)
  return fields
}

// ---- small pieces ---------------------------------------------------------------------------

function AliasChips({ aliases, onChange }: { aliases: string[]; onChange(next: string[]): void }) {
  const [text, setText] = useState('')
  const commit = () => {
    const a = text.trim()
    setText('')
    if (a && !aliases.includes(a)) onChange([...aliases, a])
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !text && aliases.length > 0) {
      onChange(aliases.slice(0, -1))
    }
  }
  return (
    <div className="chips">
      {aliases.map((a) => (
        <span key={a} className="chip alias">
          {a}
          <button type="button" aria-label={`Remove alias ${a}`} onClick={() => onChange(aliases.filter((x) => x !== a))}>
            ×
          </button>
        </span>
      ))}
      <input aria-label="Add alias" placeholder="Add alias…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={commit} />
    </div>
  )
}

function Relationships({ card, onChange }: { card: Card; onChange(c: Card): void }) {
  const { cards } = useBook()
  const others = cards.character.filter((c) => c.id !== card.id)
  const nameOf = (id: string) => cards.character.find((c) => c.id === id)?.name ?? id
  const [to, setTo] = useState('')
  const [kind, setKind] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const target = to || others[0]?.id || ''

  const add = async () => {
    if (!target || !kind.trim()) return
    setError(null)
    const rel: Relationship = { to: target, kind: kind.trim() }
    if (note.trim()) rel.note = note.trim()
    try {
      onChange(await api.addRelationship(card.id, rel))
      setKind('')
      setNote('')
    } catch {
      setError('Could not add that relationship.')
    }
  }
  const remove = async (r: Relationship) => {
    setError(null)
    try {
      onChange(await api.removeRelationship(card.id, { to: r.to, kind: r.kind }))
    } catch {
      setError('Could not remove that relationship.')
    }
  }

  return (
    <section className="field-group" aria-label="Relationships">
      <h2>Relationships</h2>
      <ul className="rel-list">
        {card.relationships.map((r) => (
          <li key={`${r.to}|${r.kind}`}>
            <span>
              <em>{r.kind}</em> <strong>{nameOf(r.to)}</strong>
              {r.note && <span className="muted"> · {r.note}</span>}
            </span>
            <button type="button" className="ghost small" aria-label={`Remove ${r.kind} ${nameOf(r.to)}`} onClick={() => void remove(r)}>
              Remove
            </button>
          </li>
        ))}
        {card.relationships.length === 0 && <li className="muted">No relationships yet.</li>}
      </ul>
      {others.length === 0 ? (
        <p className="muted">Add another character to link them here.</p>
      ) : (
        <form
          className="rel-form"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <select aria-label="Related character" value={target} onChange={(e) => setTo(e.target.value)}>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input aria-label="Relationship" placeholder="trusts, rivals, mentors…" value={kind} onChange={(e) => setKind(e.target.value)} />
          <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="primary small" disabled={!kind.trim()}>
            Add
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

// ---- the editor -----------------------------------------------------------------------------

interface CardEditorProps {
  kind: CardKind
  id: string
  onSaveState?(s: SaveState | null): void
  /** The card is gone (deleted here or elsewhere): go back to the list. */
  onGone(): void
}

/** Mount with `key={kind:id}`: unmounting flushes the save. Autosaves like the chapter editor. */
export function CardEditor({ kind, id, onSaveState, onGone }: CardEditorProps) {
  const { refresh } = useBook()
  const onSaveStateRef = useRef(onSaveState)
  onSaveStateRef.current = onSaveState
  const onGoneRef = useRef(onGone)
  onGoneRef.current = onGone

  const [card, setCard] = useState<Card | null>(null)
  const [draft, setDraftState] = useState<Omit<Draft, 'base'> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [theirs, setTheirs] = useState<Card | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const [loadTick, setLoadTick] = useState(0)

  const baseRef = useRef('') // the on-disk version our next save builds on
  const fieldsRef = useRef<Record<string, unknown>>({})
  const draftRef = useRef<Omit<Draft, 'base'> | null>(null)
  const queueRef = useRef<SaveQueue<Draft> | null>(null)
  const goneRef = useRef(false)

  const show = useCallback((c: Card, d: Omit<Draft, 'base'> = draftOf(c)) => {
    fieldsRef.current = c.fields
    draftRef.current = d
    setDraftState(d)
    setCard(c)
  }, [])

  useEffect(() => {
    let open = true
    const me = {}
    reporter = me
    const storage = localStore()
    const key = `card:${kind}:${id}`
    const q = createSaveQueue<Draft>({
      key,
      save: async (d) => {
        // A card needs a name: while the field is blank, the rest is saved and the name on disk is kept.
        const saved = await api.saveCard(
          kind,
          id,
          {
            ...(d.name.trim() ? { name: d.name } : {}),
            aliases: d.aliases,
            summary: d.summary,
            body: d.body,
            fields: fieldsFor(kind, fieldsRef.current, d),
          },
          baseRef.current,
        )
        baseRef.current = saved.version
        fieldsRef.current = saved.fields
      },
      isConflict: conflictOf,
      storage,
      onStatus: (s) => {
        if (reporter === me) onSaveStateRef.current?.({ status: s, retry: () => void q.retry() })
        if (open && s.state === 'conflict') setTheirs(s.theirs as Card)
        if (!open && s.state === 'saved') {
          void q.dispose()
          liveQueues.delete(q)
        }
      },
    })
    queueRef.current = q
    liveQueues.add(q)

    void (async () => {
      try {
        await closing.get(key)
        const c = await api.getCard(kind, id)
        if (!open) return
        baseRef.current = c.version
        setLoadError(false)
        const disk = draftOf(c)
        const saved = restoreUnsaved<Draft>(key, storage)
        if (saved && typeof saved.name === 'string' && !sameDraft(saved, disk)) {
          const { base, ...rest } = saved
          show(c, { ...disk, ...rest })
          // Build on the version the draft was written against, so a changed file surfaces as a conflict.
          baseRef.current = base || c.version
          q.update({ ...disk, ...rest, base: baseRef.current })
          void q.flush()
        } else {
          show(c)
          if (saved) q.discard()
          if (reporter === me) onSaveStateRef.current?.(null)
        }
      } catch {
        if (open) setLoadError(true)
      }
    })()

    return () => {
      open = false
      const done = q.flush().then(() => {
        if (!q.hasUnsaved()) {
          void q.dispose()
          liveQueues.delete(q)
        }
      })
      closing.set(key, done)
      void done.finally(() => {
        if (closing.get(key) === done) closing.delete(key)
      })
      if (reporter === me) onSaveStateRef.current?.(null)
    }
  }, [kind, id, loadTick, show])

  // Outside changes: reload silently when clean; when dirty, saving surfaces a 409 if it really changed.
  const onOutsideChange = useCallback(async () => {
    const q = queueRef.current
    if (!q || goneRef.current) return
    if (q.hasUnsaved()) return void q.flush()
    const startBase = baseRef.current
    try {
      const c = await api.getCard(kind, id)
      // A save of our own that landed meanwhile is newer than this read.
      if (baseRef.current !== startBase) return
      if (c.version === baseRef.current || queueRef.current !== q) return
      if (q.hasUnsaved()) return void q.flush()
      baseRef.current = c.version
      show(c)
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 404 && !goneRef.current) {
        goneRef.current = true
        onGoneRef.current()
      }
    }
  }, [kind, id, show])

  useEffect(
    () =>
      api.subscribeChanges(
        (c) => {
          if (c.type !== 'card' || c.kind !== kind || c.id !== id) return
          if (c.deleted) {
            if (!goneRef.current) {
              goneRef.current = true
              queueRef.current?.discard()
              onGoneRef.current()
            }
          } else void onOutsideChange()
        },
        () => void onOutsideChange(),
      ),
    [kind, id, onOutsideChange],
  )

  const edit = (patch: Partial<Omit<Draft, 'base'>>) => {
    const next = { ...(draftRef.current as Omit<Draft, 'base'>), ...patch }
    draftRef.current = next
    setDraftState(next)
    queueRef.current?.update({ ...next, base: baseRef.current })
  }

  const loadTheirs = async () => {
    const q = queueRef.current
    if (!q) return
    try {
      const c = await api.getCard(kind, id)
      q.discard()
      baseRef.current = c.version
      show(c)
      setTheirs(null)
    } catch {
      // keep the banner; the author can try again
    }
  }

  const keepMine = () => {
    const q = queueRef.current
    if (!q || !theirs) return
    baseRef.current = theirs.version
    setTheirs(null)
    void q.retry()
  }

  // Relationship edits have their own endpoints; each returns the card with its new version.
  const onRelationships = (c: Card) => {
    baseRef.current = c.version
    fieldsRef.current = c.fields
    setCard(c)
    void refresh()
  }

  const remove = async () => {
    setConfirmDelete(false)
    setDeleteError(false)
    try {
      await api.deleteCard(kind, id)
    } catch {
      // Nothing was deleted: the queue and the stored draft stay as they were.
      setDeleteError(true)
      return
    }
    goneRef.current = true
    queueRef.current?.discard() // nothing left to save to a card that is gone
    await refresh()
    onGoneRef.current()
  }

  if (loadError) {
    return (
      <div className="card-editor editor-message">
        <p>Couldn’t open this card.</p>
        <button type="button" className="ghost" onClick={() => setLoadTick((t) => t + 1)}>
          Try again
        </button>
      </div>
    )
  }
  if (!card || !draft) return <div className="card-editor" aria-busy="true" />

  return (
    <article className="card-editor" aria-label={`${KIND_LABEL[kind]}: ${card.name}`}>
      {theirs && (
        <div className="banner conflict" role="alert">
          <span>This card changed outside Loreloom.</span>
          <span className="banner-actions">
            <button type="button" className="ghost" onClick={() => void loadTheirs()}>
              Load theirs
            </button>
            <button type="button" className="primary" onClick={keepMine}>
              Keep mine
            </button>
          </span>
        </div>
      )}
      <p className="kind-label">{KIND_LABEL[kind]}</p>
      <input className="card-name" aria-label={kind === 'term' ? 'Term' : 'Name'} value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
      {!draft.name.trim() && <p className="form-error">A card needs a name before it can be saved.</p>}

      <div className="field-group">
        <span className="field-label">Aliases</span>
        <AliasChips aliases={draft.aliases} onChange={(aliases) => edit({ aliases })} />
      </div>
      {kind === 'character' && (
        <div className="field-group">
          <label htmlFor="card-role">Role</label>
          <input id="card-role" value={draft.role} onChange={(e) => edit({ role: e.target.value })} placeholder="Protagonist, mentor, rival…" />
        </div>
      )}
      {kind === 'term' && (
        <div className="field-group">
          <label htmlFor="card-pron">Pronunciation</label>
          <input id="card-pron" value={draft.pronunciation} onChange={(e) => edit({ pronunciation: e.target.value })} placeholder="e.g. KEER-uh-min" />
        </div>
      )}
      <div className="field-group">
        <label htmlFor="card-summary">{kind === 'term' ? 'Definition' : 'Summary'}</label>
        <input id="card-summary" value={draft.summary} onChange={(e) => edit({ summary: e.target.value })} placeholder="One line the helper can always rely on" />
      </div>
      <div className="field-group">
        <label htmlFor="card-body">Notes</label>
        <textarea id="card-body" rows={12} value={draft.body} onChange={(e) => edit({ body: e.target.value })} />
      </div>

      {kind === 'character' && <Relationships card={card} onChange={onRelationships} />}

      <div className="card-danger">
        <button type="button" className="ghost danger-text" onClick={() => setConfirmDelete(true)}>
          Delete {KIND_LABEL[kind].toLowerCase()}
        </button>
        {deleteError && (
          <p className="form-error" role="alert">
            Could not delete. Your edits are kept.
          </p>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${card.name || 'this card'}?`}
          message="It will be moved to .loreloom/trash in your book folder. You can restore it from there."
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </article>
  )
}
