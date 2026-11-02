import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../api.ts'
import type { ChapterSummary } from '../api.ts'
import { useBook } from '../state/BookContext.tsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import { moveId } from './order.ts'

interface CardProps {
  chapter: ChapterSummary
  index: number
  pages: number
  renaming: boolean
  onOpen(): void
  onStartRename(): void
  onRename(title: string): void
  onCancelRename(): void
  onDelete(): void
}

function ChapterCard({ chapter, index, pages, renaming, onOpen, onStartRename, onRename, onCancelRename, onDelete }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id })
  const [draft, setDraft] = useState(chapter.title)
  useEffect(() => {
    if (renaming) setDraft(chapter.title)
  }, [renaming, chapter.title])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = draft.trim()
    if (t && t !== chapter.title) onRename(t)
    else onCancelRename()
  }
  return (
    <li
      ref={setNodeRef}
      className={`chapter-card${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-chapter-id={chapter.id}
    >
      <div className="chapter-card-top">
        <button type="button" className="icon drag-handle" aria-label={`Drag to reorder ${chapter.title}`} {...attributes} {...listeners}>
          ⠿
        </button>
        <span className="chapter-num">{index + 1}</span>
        <span className={`chip status-${chapter.status}`}>{chapter.status}</span>
        <span className="chapter-pages">{pages > 0 ? `${pages}p` : '—'}</span>
      </div>
      {renaming ? (
        <form onSubmit={submit}>
          <input
            className="rename-input"
            aria-label="Chapter title"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => e.key === 'Escape' && onCancelRename()}
          />
        </form>
      ) : (
        <button type="button" className="chapter-open" onClick={onOpen}>
          <span className="chapter-title">{chapter.title}</span>
          <span className="chapter-summary">{chapter.summary || 'No summary yet'}</span>
        </button>
      )}
      <div className="chapter-card-actions">
        <button type="button" className="ghost small" onClick={onStartRename}>
          Rename
        </button>
        <button type="button" className="ghost small danger-text" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  )
}

export function ChaptersView() {
  const { chapters, stats, refresh, setCurrentChapterId, setView } = useBook()
  const [order, setOrder] = useState<string[]>(() => chapters.map((c) => c.id))
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [deleting, setDeleting] = useState<ChapterSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The server order is the truth; follow it whenever the chapter list changes.
  useEffect(() => setOrder(chapters.map((c) => c.id)), [chapters])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const byId = new Map(chapters.map((c) => [c.id, c]))
  const pages = new Map(stats?.perChapter.map((c) => [c.id, c.pages]))
  const ordered = order.map((id) => byId.get(id)).filter((c): c is ChapterSummary => !!c)

  const run = async (what: () => Promise<unknown>) => {
    setError(null)
    try {
      await what()
    } catch {
      setError('That did not work. Is Loreloom still running?')
    }
    await refresh()
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const next = moveId(order, String(active.id), String(over.id))
    if (next === order) return
    setOrder(next)
    void run(() => api.reorderChapters(next))
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    setAdding(false)
    setNewTitle('')
    void run(() => api.createChapter(title))
  }

  return (
    <section className="board" aria-label="Chapters">
      <header className="board-head">
        <h1>Chapters</h1>
        {adding ? (
          <form className="inline-form" onSubmit={add}>
            <input aria-label="New chapter title" autoFocus placeholder="Chapter title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <button type="submit" className="primary small" disabled={!newTitle.trim()}>
              Add
            </button>
            <button type="button" className="ghost small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="primary small" onClick={() => setAdding(true)}>
            + Add chapter
          </button>
        )}
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {ordered.length === 0 && <p className="muted">No chapters yet.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <ul className="chapter-grid">
            {ordered.map((c, i) => (
              <ChapterCard
                key={c.id}
                chapter={c}
                index={i}
                pages={pages.get(c.id) ?? 0}
                renaming={renamingId === c.id}
                onOpen={() => {
                  setCurrentChapterId(c.id)
                  setView('write')
                }}
                onStartRename={() => setRenamingId(c.id)}
                onCancelRename={() => setRenamingId(null)}
                onRename={(title) => {
                  setRenamingId(null)
                  void run(() => api.saveChapter(c.id, { title }))
                }}
                onDelete={() => setDeleting(c)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {deleting && (
        <ConfirmDialog
          title="Delete this chapter?"
          message={`"${deleting.title}" will be moved to .loreloom/trash in your book folder. You can restore it from there.`}
          confirmLabel="Delete chapter"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id
            setDeleting(null)
            void run(() => api.deleteChapter(id))
          }}
        />
      )}
    </section>
  )
}
