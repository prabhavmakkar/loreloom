import { FirstRun } from './layout/FirstRun.tsx'
import { Sidebar } from './layout/Sidebar.tsx'
import { TopBar } from './layout/TopBar.tsx'
import { BookProvider, useBook } from './state/BookContext.tsx'
import { useStored } from './useStored.ts'

// Placeholders: replaced by the real components in later tasks.
function EditorPlaceholder({ title }: { title: string | null }) {
  return (
    <article className="prose placeholder">
      <h1>{title ?? 'No chapter yet'}</h1>
      <p>Editor coming in Task 8.</p>
    </article>
  )
}
const WorldPlaceholder = () => <div className="placeholder-view">World view (CardEditor) coming in Task 9.</div>
const ChaptersPlaceholder = () => <div className="placeholder-view">Chapters view coming in Task 9.</div>
const HelperPlaceholder = () => <div className="placeholder-view">Helper tabs coming in Task 10.</div>

function Shell() {
  const { loaded, error, exists, view, chapters, currentChapterId } = useBook()
  const [helperOpen, setHelperOpen] = useStored('loreloom-helper', true)

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

  const title = chapters.find((c) => c.id === currentChapterId)?.title ?? null
  return (
    <div className={`shell${helperOpen ? '' : ' helper-closed'}`}>
      <TopBar helperOpen={helperOpen} onToggleHelper={() => setHelperOpen(!helperOpen)} />
      <Sidebar />
      <main className="centre">
        {view === 'write' && <EditorPlaceholder title={title} />}
        {view === 'world' && <WorldPlaceholder />}
        {view === 'chapters' && <ChaptersPlaceholder />}
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
