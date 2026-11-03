import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { aiStatus } from '../api.ts'
import type { AiStatus } from '../api.ts'
import type { EditorHandle } from '../editor/handle.ts'
import { useBook } from '../state/BookContext.tsx'
import { BrainstormTab } from './BrainstormTab.tsx'
import { DraftTab } from './DraftTab.tsx'
import { NOT_INSTALLED, NOT_LOGGED_IN, UNRESPONSIVE } from './parts.tsx'
import { ReviewTab } from './ReviewTab.tsx'

const TABS = ['Brainstorm', 'Draft', 'Review'] as const
type Tab = (typeof TABS)[number]

export function HelperPanel({ editor }: { editor: RefObject<EditorHandle | null> }) {
  const { currentChapterId, bookId } = useBook()
  const [tab, setTab] = useState<Tab>('Brainstorm')
  const [status, setStatus] = useState<AiStatus | null>(null)

  const check = useCallback(() => {
    aiStatus()
      .then(setStatus)
      .catch(() => {}) // keep the last known status; the server being down shows elsewhere
  }, [])
  useEffect(() => {
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [check])

  if (status && !status.available) {
    return (
      <div className="helper-panel">
        <div className="helper-notice" role="alert">
          <p>{status.reason === 'not_installed' ? NOT_INSTALLED : status.reason === 'unresponsive' ? UNRESPONSIVE : NOT_LOGGED_IN}</p>
          <button type="button" className="small" onClick={check}>
            Check again
          </button>
        </div>
      </div>
    )
  }

  const bookKey = bookId ?? ''
  return (
    <div className="helper-panel">
      <div className="helper-tabs" role="tablist" aria-label="Helper">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" id={`helper-tab-${t}`} aria-selected={tab === t} aria-controls={`helper-pane-${t}`} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {/* All panes stay mounted so a reply keeps streaming while the author looks at another tab. */}
      <div role="tabpanel" id="helper-pane-Brainstorm" aria-labelledby="helper-tab-Brainstorm" hidden={tab !== 'Brainstorm'}>
        <BrainstormTab bookKey={bookKey} chapterId={currentChapterId} editor={editor} />
      </div>
      <div role="tabpanel" id="helper-pane-Draft" aria-labelledby="helper-tab-Draft" hidden={tab !== 'Draft'}>
        <DraftTab chapterId={currentChapterId} editor={editor} />
      </div>
      <div role="tabpanel" id="helper-pane-Review" aria-labelledby="helper-tab-Review" hidden={tab !== 'Review'}>
        <ReviewTab chapterId={currentChapterId} editor={editor} />
      </div>
    </div>
  )
}
