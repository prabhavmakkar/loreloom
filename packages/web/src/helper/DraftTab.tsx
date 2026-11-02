import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AiRunBody } from '../api.ts'
import type { EditorHandle } from '../editor/handle.ts'
import { useBook } from '../state/BookContext.tsx'
import { ActivityLines, RunNotice } from './parts.tsx'
import { useAiRun } from './stream.ts'

const PROSE_ONLY = 'Write only the prose itself, with no preamble, headings or commentary, so it can be pasted straight into the chapter.'
const TAIL_CHARS = 1500

export const CONTINUE_MESSAGE = `Continue the story from the cursor, in the same voice, tense and style as the chapter. ${PROSE_ONLY}`
export const NEXT_SCENE_MESSAGE = `Draft the next scene, following on from where this chapter leaves off and staying consistent with the world cards and rules. ${PROSE_ONLY}`

export function DraftTab({ chapterId, editor }: { chapterId: string | null; editor: RefObject<EditorHandle | null> }) {
  const [instruction, setInstruction] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const [copied, setCopied] = useState(false)
  const { run, cancel, reset, state, text, activity, error } = useAiRun()
  const last = useRef<AiRunBody | null>(null)
  const running = state === 'running'
  const canEdit = useBook().view === 'write' // the chapter editor is only mounted in the write view

  // Re-checked on focus and when a run ends, not polled.
  const checkSelection = useCallback(() => setHasSelection((editor.current?.getSelectionText() ?? '') !== ''), [editor])
  useEffect(() => {
    window.addEventListener('focus', checkSelection)
    return () => window.removeEventListener('focus', checkSelection)
  }, [checkSelection])
  useEffect(() => {
    if (!running) checkSelection()
  }, [running, checkSelection])
  // The reply was written for one chapter: switching away stops it and drops the draft.
  useEffect(() => reset, [chapterId, reset])

  const start = (message: string, withContext: boolean) => {
    const selection = editor.current?.getSelectionText() ?? ''
    let full = message
    if (withContext) {
      // Continue from the cursor (or from the end of the selection), not from the end of the chapter.
      const before = (editor.current?.getTextBeforeCursor() ?? '').slice(-TAIL_CHARS).trim()
      if (before) full += `\n\nThe text before the cursor ends:\n${before}`
    }
    const body: AiRunBody = { mode: 'draft', message: full, ...(chapterId ? { chapterId } : {}), ...(selection ? { selection } : {}) }
    last.current = body
    setCopied(false)
    void run(body)
  }

  const custom = () => {
    const ask = instruction.trim()
    if (ask && !running) start(`${ask}\n\n${PROSE_ONLY}`, false)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const hasOutput = text !== ''
  return (
    <div className="helper-tab" onFocusCapture={checkSelection}>
      <div className="helper-compose">
        <textarea
          aria-label="Drafting instruction"
          rows={3}
          value={instruction}
          placeholder="What should the helper write? e.g. Kael argues with the gatekeeper."
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              custom()
            }
          }}
        />
        <div className="helper-actions">
          <button type="button" className="small primary" onClick={custom} disabled={running || !instruction.trim()}>
            Draft
          </button>
          <button type="button" className="small" onClick={() => start(CONTINUE_MESSAGE, true)} disabled={running}>
            Continue from cursor
          </button>
          <button type="button" className="small" onClick={() => start(NEXT_SCENE_MESSAGE, false)} disabled={running}>
            Draft the next scene
          </button>
          {running && (
            <button type="button" className="small ghost" onClick={cancel}>
              Stop
            </button>
          )}
        </div>
      </div>
      <ActivityLines lines={running ? activity : []} />
      {running && !hasOutput && <p className="muted hint">Writing…</p>}
      {error && <RunNotice error={error} onRetry={() => last.current && start(last.current.message, false)} />}
      {hasOutput && (
        <>
          <div className="draft-preview" aria-label="Draft preview" aria-readonly="true" tabIndex={0}>
            {text}
          </div>
          <p className="muted hint">Nothing is added to your chapter until you choose.</p>
          <div className="helper-actions">
            <button type="button" className="small primary" onClick={() => editor.current?.insertAtCursor(text)} disabled={running || !canEdit}>
              Insert at cursor
            </button>
            <button
              type="button"
              className="small"
              onClick={() => editor.current?.replaceSelection(text)}
              disabled={running || !canEdit || !hasSelection}
              title={hasSelection ? undefined : 'Select some text in the chapter first'}
            >
              Replace selection
            </button>
            <button type="button" className="small" onClick={() => void copy()} disabled={running}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="small ghost" onClick={() => last.current && start(last.current.message, false)} disabled={running}>
              Try again
            </button>
          </div>
        </>
      )}
    </div>
  )
}
