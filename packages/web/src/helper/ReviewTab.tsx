import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AiRunBody, ReviewCategory, ReviewSuggestion } from '../api.ts'
import type { EditorHandle } from '../editor/handle.ts'
import { useBook } from '../state/BookContext.tsx'
import { findQuote } from './findQuote.ts'
import { ActivityLines, RunNotice } from './parts.tsx'
import { useAiRun } from './stream.ts'

export const REVIEW_CHAPTER_MESSAGE = 'Review the current chapter. Quote only from the chapter itself, never from the world cards.'
export const REVIEW_SELECTION_MESSAGE = 'Review the selected passage. Quote only from the selected passage, never from the world cards or the surrounding text.'

const ORDER: ReviewCategory[] = ['continuity', 'prose', 'pacing', 'dialogue']
const LABEL: Record<ReviewCategory, string> = { continuity: 'Continuity', prose: 'Prose', pacing: 'Pacing', dialogue: 'Dialogue' }

type Card = 'applied' | 'dismissed' | 'missing'

export function ReviewTab({ chapterId, editor }: { chapterId: string | null; editor: RefObject<EditorHandle | null> }) {
  const [hasSelection, setHasSelection] = useState(false)
  const [done, setDone] = useState<Record<string, Card>>({})
  const [reviewed, setReviewed] = useState(false)
  const { run, cancel, reset, state, activity, suggestions, error } = useAiRun()
  const last = useRef<AiRunBody | null>(null)
  const running = state === 'running'
  const canEdit = useBook().view === 'write' // the chapter editor is only mounted in the write view

  const checkSelection = useCallback(() => setHasSelection((editor.current?.getSelectionText() ?? '') !== ''), [editor])
  useEffect(() => {
    window.addEventListener('focus', checkSelection)
    return () => window.removeEventListener('focus', checkSelection)
  }, [checkSelection])
  useEffect(() => {
    if (!running) checkSelection()
  }, [running, checkSelection])
  // Suggestions were written for one chapter: switching away stops the run and drops them.
  useEffect(
    () => () => {
      reset()
      setDone({})
      setReviewed(false)
    },
    [chapterId, reset],
  )

  const start = (body: AiRunBody) => {
    last.current = body
    setDone({})
    setReviewed(true)
    void run(body)
  }
  const reviewChapter = () => start({ mode: 'review', message: REVIEW_CHAPTER_MESSAGE, ...(chapterId ? { chapterId } : {}) })
  const reviewSelection = () => {
    const selection = editor.current?.getSelectionText() ?? ''
    if (selection) start({ mode: 'review', message: REVIEW_SELECTION_MESSAGE, ...(chapterId ? { chapterId } : {}), selection })
  }

  const mark = (id: string, v: Card) => setDone((d) => ({ ...d, [id]: v }))
  const locate = (s: ReviewSuggestion) => findQuote(editor.current?.getPlainText() ?? '', s.quote)

  const show = (s: ReviewSuggestion) => {
    const at = locate(s)
    if (at) editor.current?.highlightRange(at.from, at.to)
    else mark(s.id, 'missing')
  }
  const apply = (s: ReviewSuggestion) => {
    const at = locate(s) // the text may have changed since the review, so look again now
    if (!at) return mark(s.id, 'missing')
    editor.current?.replaceRange(at.from, at.to, s.fix)
    mark(s.id, 'applied')
  }

  const visible = suggestions.filter((s) => done[s.id] !== 'dismissed')
  const groups = ORDER.map((c) => ({ category: c, items: visible.filter((s) => s.category === c) })).filter((g) => g.items.length > 0)

  return (
    <div className="helper-tab" onFocusCapture={checkSelection}>
      <div className="helper-actions">
        <button type="button" className="small" onClick={reviewSelection} disabled={running || !hasSelection} title={hasSelection ? undefined : 'Select some text in the chapter first'}>
          Review selection
        </button>
        <button type="button" className="small primary" onClick={reviewChapter} disabled={running || !chapterId}>
          Review chapter
        </button>
        {running && (
          <button type="button" className="small ghost" onClick={cancel}>
            Stop
          </button>
        )}
      </div>
      <ActivityLines lines={running ? activity : []} />
      {running && suggestions.length === 0 && <p className="muted hint">Reading…</p>}
      {error && <RunNotice error={error} onRetry={() => last.current && start(last.current)} />}
      {state === 'idle' && reviewed && suggestions.length === 0 && !error && <p className="muted hint">Nothing to flag.</p>}
      {groups.map((g) => (
        <section key={g.category} className="review-group" aria-label={LABEL[g.category]}>
          <h3>{LABEL[g.category]}</h3>
          {g.items.map((s) => {
            const st = done[s.id]
            return (
              <article key={s.id} className={`review-card${st === 'applied' ? ' applied' : ''}`} data-category={s.category}>
                <button type="button" className="review-quote" onClick={() => show(s)} title="Show in chapter">
                  {s.quote}
                </button>
                <p className="review-issue">{s.issue}</p>
                <p className="review-fix">{s.fix === '' ? <em>Cut this.</em> : s.fix}</p>
                {st === 'missing' && <p className="muted hint">Can't find this passage anymore</p>}
                <div className="helper-actions">
                  <button type="button" className="small primary" onClick={() => apply(s)} disabled={running || !canEdit || st === 'applied' || st === 'missing'}>
                    {st === 'applied' ? 'Applied' : 'Apply'}
                  </button>
                  <button type="button" className="small ghost" onClick={() => mark(s.id, 'dismissed')}>
                    Dismiss
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      ))}
      {suggestions.length > 0 && <p className="muted hint">Nothing changes in your chapter until you click Apply.</p>}
    </div>
  )
}
