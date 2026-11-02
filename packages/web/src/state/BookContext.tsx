import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from '../api.ts'
import type { BookMeta, BookStats, Card, CardKind, ChapterSummary } from '../api.ts'

export type View = 'write' | 'world' | 'chapters'
export const CARD_KINDS: CardKind[] = ['character', 'place', 'rule', 'term']

export interface BookState {
  /** False until the first request to the server has finished. */
  loaded: boolean
  /** Set when the server can't be reached. */
  error: string | null
  exists: boolean
  meta: BookMeta | null
  stats: BookStats | null
  chapters: ChapterSummary[]
  cards: Record<CardKind, Card[]>
  currentChapterId: string | null
  setCurrentChapterId(id: string | null): void
  view: View
  setView(view: View): void
  refresh(): Promise<void>
}

const emptyCards = (): Record<CardKind, Card[]> => ({ character: [], place: [], rule: [], term: [] })

const BookContext = createContext<BookState | null>(null)

export function useBook(): BookState {
  const ctx = useContext(BookContext)
  if (!ctx) throw new Error('useBook must be used inside <BookProvider>')
  return ctx
}

export function BookProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const [meta, setMeta] = useState<BookMeta | null>(null)
  const [stats, setStats] = useState<BookStats | null>(null)
  const [chapters, setChapters] = useState<ChapterSummary[]>([])
  const [cards, setCards] = useState<Record<CardKind, Card[]>>(emptyCards)
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null)
  const [view, setView] = useState<View>('write')

  // Only the latest refresh may write state, so a slow response can't clobber a newer one.
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const info = await api.getBook()
      if (mine !== seq.current) return
      if (!info.exists) {
        setExists(false)
        setMeta(null)
        setStats(null)
        setChapters([])
        setCards(emptyCards())
        setError(null)
        return
      }
      const [st, chs, all] = await Promise.all([api.getStats(), api.listChapters(), api.listCards()])
      if (mine !== seq.current) return
      const grouped = emptyCards()
      for (const c of all) grouped[c.kind].push(c)
      setExists(true)
      setMeta(info.meta)
      setStats(st)
      setChapters(chs)
      setCards(grouped)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      setError(err instanceof api.ApiError ? `The server answered with an error (${err.status}).` : 'Cannot reach the Loreloom server.')
    } finally {
      if (mine === seq.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Every change event (including echoes of our own deletes) just means "refetch";
  // so does a reconnect, since changes made while disconnected are never replayed.
  useEffect(() => (exists ? api.subscribeChanges(() => void refresh(), () => void refresh()) : undefined), [exists, refresh])

  // Keep a valid chapter selected as chapters appear or disappear.
  useEffect(() => {
    if (!loaded) return
    setCurrentChapterId((cur) => (cur && chapters.some((c) => c.id === cur) ? cur : (chapters[0]?.id ?? null)))
  }, [chapters, loaded])

  const value = useMemo<BookState>(
    () => ({ loaded, error, exists, meta, stats, chapters, cards, currentChapterId, setCurrentChapterId, view, setView, refresh }),
    [loaded, error, exists, meta, stats, chapters, cards, currentChapterId, view, refresh],
  )
  return <BookContext.Provider value={value}>{children}</BookContext.Provider>
}
