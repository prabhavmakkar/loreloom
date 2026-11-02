import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import * as api from '../api.ts'
import type { Chapter } from '../api.ts'
import { createSaveQueue, restoreUnsaved, unsavedAt } from '../save/saveQueue.ts'
import type { SaveQueue, SaveStatus } from '../save/saveQueue.ts'
import { useBook } from '../state/BookContext.tsx'
import { createEditorHandle, PassageHighlight } from './handle.ts'
import type { EditorHandle } from './handle.ts'
import { markdownExtensions } from './markdown.ts'
import { cardSuggestion } from './mentions.tsx'

export type { EditorHandle } from './handle.ts'

/** What the top bar shows, and how its "Not saved: retry" reaches the queue. */
export interface SaveState {
  status: SaveStatus
  retry(): void
}

/** The unsaved text, plus the on-disk version it was written on top of. */
interface Draft {
  body: string
  base: string
}

// ---- page-wide safety net ----------------------------------------------------------------

/** Queues that may still hold unsaved text, including ones for chapters no longer open. */
const liveQueues = new Set<SaveQueue<Draft>>()
const queueByChapter = new Map<string, SaveQueue<Draft>>()
/** A chapter's pending final save; reopening that chapter waits for it. */
const closing = new Map<string, Promise<void>>()
/** Only the most recently opened editor reports to the top bar. */
let reporter: object | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if ([...liveQueues].some((q) => q.hasUnsaved())) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
  // Leaving the tab is the last good moment to try; the text is in localStorage regardless.
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

const isChapter = (v: unknown): v is Chapter =>
  !!v && typeof v === 'object' && typeof (v as Chapter).body === 'string' && typeof (v as Chapter).version === 'string'

function conflictOf(err: unknown): Chapter | null {
  if (!(err instanceof api.ApiError) || err.status !== 409) return null
  const current = (err.body as { current?: unknown } | null)?.current
  return isChapter(current) ? current : null
}

function formatWhen(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

/** Replaces the document without counting as an edit. */
function setBody(editor: TiptapEditor, body: string) {
  editor.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
}

// ---- the editor ---------------------------------------------------------------------------

interface EditorProps {
  chapterId: string
  onSaveState?(s: SaveState | null): void
}

/**
 * The chapter editor. Mount it with `key={chapterId}`: unmounting flushes the save.
 * Every keystroke goes to localStorage at once and to disk after a short pause.
 */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ chapterId, onSaveState }, ref) {
  const { cards } = useBook()
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const onSaveStateRef = useRef(onSaveState)
  onSaveStateRef.current = onSaveState

  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<Chapter | null>(null)

  const baseRef = useRef('') // the on-disk version our next save builds on
  const queueRef = useRef<SaveQueue<Draft> | null>(null)
  const [loadTick, setLoadTick] = useState(0)

  const extensions = useMemo(() => [...markdownExtensions({ mention: { suggestion: cardSuggestion(() => cardsRef.current) } }), PassageHighlight], [])
  const editor = useEditor({
    extensions,
    editable: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'prose-editor', 'aria-label': 'Chapter text', spellcheck: 'true' } },
    // Only real edits count. TipTap also emits `update` from setEditable(), which must never
    // be mistaken for the author's text (it would queue whatever the document holds then).
    onUpdate: ({ editor: ed, transaction }) => {
      if (!transaction.docChanged) return
      queueRef.current?.update({ body: ed.getMarkdown(), base: baseRef.current })
    },
  })

  useImperativeHandle(ref, () => createEditorHandle(() => editor), [editor])

  // One save queue per open chapter; load the chapter and any draft left behind.
  useEffect(() => {
    if (!editor) return
    let open = true
    const me = {}
    reporter = me
    const storage = localStore()
    const key = `chapter:${chapterId}`
    const q = createSaveQueue<Draft>({
      key,
      save: async (d) => {
        const saved = await api.saveChapter(chapterId, { body: d.body }, baseRef.current)
        baseRef.current = saved.version
      },
      isConflict: conflictOf,
      storage,
      onStatus: (s) => {
        if (reporter === me) onSaveStateRef.current?.({ status: s, retry: () => void q.retry() })
        if (open && s.state === 'conflict') setTheirs(s.theirs as Chapter)
        if (!open && s.state === 'saved') {
          q.dispose()
          liveQueues.delete(q)
        }
      },
    })
    queueRef.current = q
    liveQueues.add(q)

    void (async () => {
      try {
        await closing.get(chapterId)
        // A queue still retrying for this chapter (say, the server was down) is superseded:
        // its draft is in storage and gets restored below.
        const stale = queueByChapter.get(chapterId)
        if (stale && stale !== q) {
          stale.dispose()
          liveQueues.delete(stale)
        }
        queueByChapter.set(chapterId, q)
        const ch = await api.getChapter(chapterId)
        if (!open) return
        baseRef.current = ch.version
        setBody(editor, ch.body)
        const draft = restoreUnsaved<Draft>(key, storage)
        if (draft && typeof draft.body === 'string' && draft.body !== ch.body) {
          setBody(editor, draft.body)
          setRestoredAt(unsavedAt(key, storage) ?? Date.now())
          // Build on the version the draft was written against: if the file changed since,
          // the save gets a 409 and the author chooses, instead of the draft silently winning.
          baseRef.current = draft.base || ch.version
          q.update({ body: draft.body, base: baseRef.current })
          void q.flush()
        } else if (draft) {
          q.discard()
        } else if (reporter === me) {
          onSaveStateRef.current?.(null) // nothing to report until the first edit
        }
        setChapter(ch)
        setLoadError(false)
        editor.setEditable(true, false)
      } catch {
        if (open) setLoadError(true)
      }
    })()

    return () => {
      open = false
      if (!editor.isDestroyed) editor.setEditable(false, false)
      const done = q.flush().then(() => {
        if (!q.hasUnsaved()) {
          q.dispose()
          liveQueues.delete(q)
          if (queueByChapter.get(chapterId) === q) queueByChapter.delete(chapterId)
        }
      })
      closing.set(chapterId, done)
      void done.finally(() => {
        if (closing.get(chapterId) === done) closing.delete(chapterId)
      })
    }
  }, [editor, chapterId, loadTick])

  // Outside changes: reload silently when clean; when dirty, try to save, which surfaces a
  // conflict (409) if the file really changed.
  const onOutsideChange = useCallback(async () => {
    const q = queueRef.current
    if (!editor || !q) return
    if (q.hasUnsaved()) return void q.flush()
    try {
      const ch = await api.getChapter(chapterId)
      if (ch.version === baseRef.current || queueRef.current !== q) return
      if (q.hasUnsaved()) return void q.flush()
      baseRef.current = ch.version
      const { from, to } = editor.state.selection
      setBody(editor, ch.body)
      const end = editor.state.doc.content.size
      editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) })
      setChapter(ch)
    } catch {
      // deleted or unreachable: the book refresh handles it
    }
  }, [editor, chapterId])

  useEffect(
    () =>
      api.subscribeChanges(
        (c) => {
          if (c.type === 'chapter' && c.id === chapterId && !c.deleted) void onOutsideChange()
        },
        () => void onOutsideChange(),
      ),
    [chapterId, onOutsideChange],
  )

  const loadTheirs = async () => {
    const q = queueRef.current
    if (!editor || !q) return
    try {
      const ch = await api.getChapter(chapterId)
      q.discard()
      baseRef.current = ch.version
      setBody(editor, ch.body)
      setChapter(ch)
      setTheirs(null)
      setRestoredAt(null)
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

  if (loadError) {
    return (
      <div className="prose editor-message">
        <p>Couldn’t open this chapter.</p>
        <button type="button" className="ghost" onClick={() => setLoadTick((t) => t + 1)}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <article className="prose editor" aria-busy={!chapter}>
      {theirs && (
        <div className="banner conflict" role="alert">
          <span>This chapter changed outside Loreloom.</span>
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
      {restoredAt !== null && !theirs && (
        <div className="banner notice" role="status">
          <span>Restored unsaved changes from {formatWhen(restoredAt)}</span>
          <button type="button" className="icon" aria-label="Dismiss" onClick={() => setRestoredAt(null)}>
            ×
          </button>
        </div>
      )}
      <h1>{chapter?.title ?? ''}</h1>
      <EditorContent editor={editor} />
    </article>
  )
})
