/**
 * Debounced autosave with a localStorage safety net. Framework-free.
 *
 * Every `update` is written to storage first, so a crash, a dead server or a closed tab
 * never loses text; the entry is removed only once the newest value is on disk.
 */

export type SaveStatus =
  | { state: 'saved'; at: number }
  | { state: 'dirty' }
  | { state: 'saving' }
  | { state: 'error'; message: string }
  | { state: 'conflict'; theirs: unknown }

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface SaveQueueOptions<T> {
  key: string
  save: (v: T) => Promise<unknown>
  /** Returns the other side's data when the error is an edit conflict, otherwise null. */
  isConflict: (e: unknown) => unknown | null
  storage: KeyValueStorage
  onStatus: (s: SaveStatus) => void
  debounceMs?: number
  retryMs?: number
}

export interface SaveQueue<T> {
  /** Records a new value: stored at once, saved after the debounce. */
  update(v: T): void
  /** Saves any pending value now; resolves once nothing is left to save (or a save failed). */
  flush(): Promise<void>
  /** Saves now, also after an error or a conflict. */
  retry(): Promise<void>
  hasUnsaved(): boolean
  /** Drops the unsaved value and its stored copy (the author chose the version on disk). */
  discard(): void
  /**
   * Stops timers. The stored copy stays, so the text can still be restored; a save already
   * in flight may land but no longer touches storage. Resolves once that save has settled.
   */
  dispose(): Promise<void>
}

interface Stored<T> {
  value: T
  at: number
}

export const storageKey = (key: string) => `loreloom:unsaved:${key}`

function readStored<T>(key: string, storage: KeyValueStorage): Stored<T> | null {
  try {
    const raw = storage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored<T>
    return parsed && typeof parsed === 'object' && 'value' in parsed ? parsed : null
  } catch {
    return null
  }
}

/** The unsaved value left behind for `key`, if any. */
export function restoreUnsaved<T>(key: string, storage: KeyValueStorage): T | null {
  return readStored<T>(key, storage)?.value ?? null
}

/** When the unsaved value for `key` was written, if any. */
export function unsavedAt(key: string, storage: KeyValueStorage): number | null {
  return readStored(key, storage)?.at ?? null
}

export function createSaveQueue<T>(o: SaveQueueOptions<T>): SaveQueue<T> {
  const debounceMs = o.debounceMs ?? 1200
  const retryMs = o.retryMs ?? 10000
  const skey = storageKey(o.key)

  let latest: T | undefined
  let seq = 0 // bumped on every update
  let savedSeq = 0 // the newest seq known to be on disk
  let inFlight: Promise<void> | null = null
  let againAfterFlight = false
  let blocked = false // in conflict: wait for the author to choose
  let failed = false
  let disposed = false
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const unsaved = () => seq !== savedSeq
  const emit = (s: SaveStatus) => {
    if (!disposed) o.onStatus(s)
  }
  const clearTimers = () => {
    clearTimeout(debounceTimer)
    clearTimeout(retryTimer)
    debounceTimer = retryTimer = undefined
  }
  const store = (value: T) => {
    try {
      o.storage.setItem(skey, JSON.stringify({ value, at: Date.now() } satisfies Stored<T>))
    } catch {
      // storage full or blocked: the server save is still attempted
    }
  }
  const unstore = () => {
    try {
      o.storage.removeItem(skey)
    } catch {
      // ignore
    }
  }

  function saveNow(): Promise<void> {
    if (inFlight) {
      againAfterFlight = true
      return inFlight
    }
    if (!unsaved() || blocked) return Promise.resolve()
    clearTimers()
    const mySeq = seq
    const value = latest as T
    failed = false
    emit({ state: 'saving' })
    inFlight = (async () => {
      try {
        await o.save(value)
        // Disposed meanwhile: another queue may own this key now, so leave storage alone.
        if (disposed) return
        savedSeq = Math.max(savedSeq, mySeq)
        if (!unsaved()) {
          unstore()
          emit({ state: 'saved', at: Date.now() })
        } else {
          emit({ state: 'dirty' })
        }
      } catch (err) {
        const theirs = o.isConflict(err)
        if (theirs !== null && theirs !== undefined) {
          blocked = true
          emit({ state: 'conflict', theirs })
        } else {
          failed = true
          emit({ state: 'error', message: err instanceof Error ? err.message : String(err) })
          if (!disposed) retryTimer = setTimeout(() => void saveNow(), retryMs)
        }
      } finally {
        inFlight = null
      }
      if (againAfterFlight && !failed && !blocked && !disposed) {
        againAfterFlight = false
        void saveNow()
      }
      againAfterFlight = false
    })()
    return inFlight
  }

  async function flush(): Promise<void> {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
    for (;;) {
      if (inFlight) {
        await inFlight
        continue
      }
      if (!unsaved() || blocked || disposed) return
      await saveNow()
      if (failed || blocked) return
    }
  }

  return {
    update(v) {
      latest = v
      seq++
      store(v)
      if (blocked || disposed) return
      emit({ state: 'dirty' })
      clearTimers()
      debounceTimer = setTimeout(() => void saveNow(), debounceMs)
    },
    flush,
    retry() {
      blocked = false
      return flush()
    },
    hasUnsaved: unsaved,
    discard() {
      clearTimers()
      savedSeq = seq
      blocked = false
      failed = false
      unstore()
      emit({ state: 'saved', at: Date.now() })
    },
    dispose() {
      disposed = true
      clearTimers()
      return inFlight ?? Promise.resolve()
    },
  }
}

/** The save-status copy, exactly as specified. */
export function formatSaveStatus(s: SaveStatus, now: number): string {
  switch (s.state) {
    case 'dirty':
    case 'saving':
      return 'Saving…'
    case 'saved': {
      const min = Math.floor((now - s.at) / 60_000)
      return min < 1 ? 'Saved · just now' : `Saved · ${min} min ago`
    }
    case 'error':
      return 'Not saved: retry'
    case 'conflict':
      return 'Changed elsewhere'
  }
}
