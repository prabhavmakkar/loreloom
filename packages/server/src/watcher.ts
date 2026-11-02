import { readFile } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'
import { CARD_DIRS } from '@loreloom/core'
import type { Book, BookChange, CardKind } from '@loreloom/core'
import { watch } from 'chokidar'

const DIR_TO_KIND = new Map(Object.entries(CARD_DIRS).map(([kind, dir]) => [dir, kind as CardKind]))

/** Maps a path inside the book to the change it represents, or null if it is not book content. */
function classify(book: Book, absPath: string): BookChange | null {
  const parts = relative(book.dir, absPath).split(sep)
  const file = parts[parts.length - 1] ?? ''
  if (parts[0] === 'book.yaml' && parts.length === 1) return { type: 'book' }
  if (!file.endsWith('.md')) return null
  const id = file.slice(0, -3)
  if (parts.length === 2 && parts[0] === 'chapters') return { type: 'chapter', id }
  if (parts.length === 3 && parts[0] === 'world') {
    const kind = DIR_TO_KIND.get(parts[1] ?? '')
    if (kind) return { type: 'card', kind, id }
  }
  return null
}

function isIgnored(path: string): boolean {
  const name = basename(path)
  return path.split(sep).includes('.loreloom') || name.startsWith('.') || name.endsWith('~') || name.endsWith('.tmp')
}

export interface BookWatcher {
  /** Resolves once the initial scan is done and changes will be reported. */
  ready: Promise<void>
  close(): Promise<void>
}

/** Reports changes to the book folder that the app did not write itself. */
export function watchBook(book: Book, onChange: (c: BookChange) => void): BookWatcher {
  const watcher = watch(book.dir, {
    ignoreInitial: true,
    ignored: isIgnored,
    awaitWriteFinish: { stabilityThreshold: 150 },
  })

  const handle = (deleted: boolean) => async (path: string) => {
    const change = classify(book, path)
    if (!change) return
    if (deleted) return onChange({ ...change, deleted: true })
    try {
      if (book.wasWrittenByMe(path, await readFile(path, 'utf8'))) return
    } catch {
      return // vanished before we could read it; the unlink event will follow
    }
    onChange(change)
  }

  watcher.on('add', handle(false)).on('change', handle(false)).on('unlink', handle(true))
  // Swallow watcher errors: a flaky fs event must not crash the server.
  watcher.on('error', () => {})
  const ready = new Promise<void>((res) => watcher.once('ready', () => res()))
  return { ready, close: () => watcher.close() }
}
