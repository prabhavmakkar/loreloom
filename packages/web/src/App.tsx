import { useRef, useState } from 'react'
import { ChaptersView } from './chapters/ChaptersView.tsx'
import { Editor } from './editor/Editor.tsx'
import type { EditorHandle, SaveState } from './editor/Editor.tsx'
import { FirstRun } from './layout/FirstRun.tsx'
import { Sidebar } from './layout/Sidebar.tsx'
import { TopBar } from './layout/TopBar.tsx'
import { BookProvider, useBook } from './state/BookContext.tsx'
import { useStored } from './useStored.ts'
import { WorldView } from './world/WorldView.tsx'

function NoChapter() {
  return (
    <article className="prose placeholder">
      <h1>No chapter yet</h1>
      <p>Add a chapter to start writing.</p>
    </article>
  )
}

// Placeholders: replaced by the real components in later tasks.
const HelperPlaceholder = () => <div className="placeholder-view">Helper tabs coming in Task 10.</div>

function Shell() {
  const { loaded, error, exists, view, chapters, currentChapterId } = useBook()
  const [helperOpen, setHelperOpen] = useStored('loreloom-helper', true)
  const [save, setSave] = useState<SaveState | null>(null)
  // For the helper (Tasks 10–11).
  const editorRef = useRef<EditorHandle>(null)

  if (!loaded) return <div className="splash" aria-busy="true">Loreloom</div>
  if (error && !exists) {
    return (
      <div className="splash">
        <p>{error}</p>
        <p className="muted">Is Loreloom still running in your terminal?</p>
      </div>
    )
  }
  if (!exists) return <FirstRun />

  return (
    <div className={`shell${helperOpen ? '' : ' helper-closed'}`}>
      <TopBar helperOpen={helperOpen} onToggleHelper={() => setHelperOpen(!helperOpen)} save={save} />
      <Sidebar />
      <main className="centre">
        {view === 'write' &&
          (currentChapterId && chapters.some((c) => c.id === currentChapterId) ? (
            <Editor key={currentChapterId} ref={editorRef} chapterId={currentChapterId} onSaveState={setSave} />
          ) : (
            <NoChapter />
          ))}
        {view === 'world' && <WorldView onSaveState={setSave} />}
        {view === 'chapters' && <ChaptersView />}
      </main>
      {helperOpen && (
        <aside className="helper" aria-label="Helper">
          <HelperPlaceholder />
        </aside>
      )}
    </div>
  )
}

export function App() {
  return (
    <BookProvider>
      <Shell />
    </BookProvider>
  )
}
