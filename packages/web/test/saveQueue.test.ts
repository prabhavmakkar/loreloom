import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSaveQueue, formatSaveStatus, restoreUnsaved } from '../src/save/saveQueue.ts'
import type { SaveStatus } from '../src/save/saveQueue.ts'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

class Conflict extends Error {
  constructor(readonly theirs: unknown) {
    super('conflict')
  }
}

const KEY = 'loreloom:unsaved:chapter:one'

function setup(save: (v: string) => Promise<unknown> = () => Promise.resolve()) {
  const storage = memoryStorage()
  const statuses: SaveStatus[] = []
  const saveFn = vi.fn(save)
  const q = createSaveQueue<string>({
    key: 'chapter:one',
    save: saveFn,
    isConflict: (e) => (e instanceof Conflict ? e.theirs : null),
    storage,
    onStatus: (s) => statuses.push(s),
  })
  const last = () => statuses[statuses.length - 1]
  return { q, storage, statuses, saveFn, last }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createSaveQueue', () => {
  it('marks dirty and stores the value, then saves after 1200 ms and clears storage', async () => {
    const { q, storage, saveFn, last } = setup()
    q.update('hello')
    expect(last()).toEqual({ state: 'dirty' })
    expect(JSON.parse(storage.getItem(KEY)!).value).toBe('hello')
    expect(q.hasUnsaved()).toBe(true)

    await vi.advanceTimersByTimeAsync(1199)
    expect(saveFn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(saveFn).toHaveBeenCalledWith('hello')
    expect(last()).toEqual({ state: 'saved', at: Date.now() })
    expect(storage.getItem(KEY)).toBeNull()
    expect(q.hasUnsaved()).toBe(false)
  })

  it('reports saving while the save is in flight', async () => {
    let resolve!: () => void
    const { q, last } = setup(() => new Promise<void>((r) => (resolve = r)))
    q.update('a')
    await vi.advanceTimersByTimeAsync(1200)
    expect(last()).toEqual({ state: 'saving' })
    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(last()?.state).toBe('saved')
  })

  it('coalesces three quick updates into a single save of the last value', async () => {
    const { q, saveFn } = setup()
    q.update('a')
    await vi.advanceTimersByTimeAsync(300)
    q.update('ab')
    await vi.advanceTimersByTimeAsync(300)
    q.update('abc')
    await vi.advanceTimersByTimeAsync(1200)
    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(saveFn).toHaveBeenCalledWith('abc')
  })

  it('on a failed save: error status, value kept, unsaved, and retries after 10000 ms', async () => {
    let fail = true
    const { q, storage, saveFn, last } = setup(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve()))
    q.update('kept')
    await vi.advanceTimersByTimeAsync(1200)
    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(last()?.state).toBe('error')
    expect(JSON.parse(storage.getItem(KEY)!).value).toBe('kept')
    expect(q.hasUnsaved()).toBe(true)

    fail = false
    await vi.advanceTimersByTimeAsync(9999)
    expect(saveFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(saveFn).toHaveBeenCalledTimes(2)
    expect(saveFn).toHaveBeenLastCalledWith('kept')
    expect(last()?.state).toBe('saved')
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('keeps retrying every 10000 ms while the save keeps failing', async () => {
    const { q, saveFn } = setup(() => Promise.reject(new Error('offline')))
    q.update('x')
    await vi.advanceTimersByTimeAsync(1200)
    await vi.advanceTimersByTimeAsync(10000)
    await vi.advanceTimersByTimeAsync(10000)
    expect(saveFn).toHaveBeenCalledTimes(3)
    expect(q.hasUnsaved()).toBe(true)
  })

  it('retry() saves immediately after an error', async () => {
    let fail = true
    const { q, saveFn, last } = setup(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve()))
    q.update('x')
    await vi.advanceTimersByTimeAsync(1200)
    fail = false
    await q.retry()
    expect(saveFn).toHaveBeenCalledTimes(2)
    expect(last()?.state).toBe('saved')
    // the pending auto-retry was cancelled
    await vi.advanceTimersByTimeAsync(10000)
    expect(saveFn).toHaveBeenCalledTimes(2)
  })

  it('on a conflict: conflict status carrying theirs, value kept, and no auto-retry', async () => {
    const theirs = { body: 'theirs', version: 'v2' }
    const { q, storage, saveFn, last } = setup(() => Promise.reject(new Conflict(theirs)))
    q.update('mine')
    await vi.advanceTimersByTimeAsync(1200)
    expect(last()).toEqual({ state: 'conflict', theirs })
    expect(JSON.parse(storage.getItem(KEY)!).value).toBe('mine')
    expect(q.hasUnsaved()).toBe(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(saveFn).toHaveBeenCalledTimes(1)
  })

  it('does not autosave further edits while in conflict until retry()', async () => {
    let conflict = true
    const { q, saveFn, last } = setup(() => (conflict ? Promise.reject(new Conflict('t')) : Promise.resolve()))
    q.update('mine')
    await vi.advanceTimersByTimeAsync(1200)
    q.update('mine, more')
    await vi.advanceTimersByTimeAsync(5000)
    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(last()?.state).toBe('conflict')
    conflict = false
    await q.retry()
    expect(saveFn).toHaveBeenCalledTimes(2)
    expect(saveFn).toHaveBeenLastCalledWith('mine, more')
    expect(last()?.state).toBe('saved')
  })

  it('an update while saving triggers a second save with the newer value; storage is not cleared by the first', async () => {
    const resolvers: (() => void)[] = []
    const { q, storage, saveFn, last } = setup(() => new Promise<void>((r) => resolvers.push(r)))
    q.update('first')
    await vi.advanceTimersByTimeAsync(1200)
    expect(saveFn).toHaveBeenCalledTimes(1)
    q.update('second')
    resolvers[0]!()
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(storage.getItem(KEY)!).value).toBe('second')
    expect(q.hasUnsaved()).toBe(true)
    expect(last()?.state).not.toBe('saved')

    await vi.advanceTimersByTimeAsync(1200)
    expect(saveFn).toHaveBeenCalledTimes(2)
    expect(saveFn).toHaveBeenLastCalledWith('second')
    resolvers[1]!()
    await vi.advanceTimersByTimeAsync(0)
    expect(storage.getItem(KEY)).toBeNull()
    expect(last()?.state).toBe('saved')
  })

  it('flush() saves the pending value now and resolves once it is written', async () => {
    const { q, saveFn, storage } = setup()
    q.update('now')
    await q.flush()
    expect(saveFn).toHaveBeenCalledWith('now')
    expect(storage.getItem(KEY)).toBeNull()
    await vi.advanceTimersByTimeAsync(1200)
    expect(saveFn).toHaveBeenCalledTimes(1)
  })

  it('flush() waits for an in-flight save and then saves the newer value', async () => {
    const resolvers: (() => void)[] = []
    const { q, saveFn } = setup(() => new Promise<void>((r) => resolvers.push(r)))
    q.update('a')
    await vi.advanceTimersByTimeAsync(1200)
    q.update('b')
    const done = q.flush()
    resolvers[0]!()
    await vi.advanceTimersByTimeAsync(0)
    expect(saveFn).toHaveBeenCalledTimes(2)
    expect(saveFn).toHaveBeenLastCalledWith('b')
    resolvers[1]!()
    await done
  })

  it('flush() with nothing pending does not save', async () => {
    const { q, saveFn } = setup()
    await q.flush()
    expect(saveFn).not.toHaveBeenCalled()
  })

  it('discard() after a conflict drops the local value and its stored copy', async () => {
    const { q, storage, saveFn, last } = setup(() => Promise.reject(new Conflict('theirs')))
    q.update('mine')
    await vi.advanceTimersByTimeAsync(1200)
    expect(last()?.state).toBe('conflict')
    q.discard()
    expect(storage.getItem(KEY)).toBeNull()
    expect(q.hasUnsaved()).toBe(false)
    expect(last()?.state).toBe('saved')
    await q.flush()
    expect(saveFn).toHaveBeenCalledTimes(1)
  })

  it('dispose() cancels timers but keeps the unsaved value in storage', async () => {
    const { q, storage, saveFn } = setup()
    q.update('draft')
    q.dispose()
    await vi.advanceTimersByTimeAsync(20000)
    expect(saveFn).not.toHaveBeenCalled()
    expect(JSON.parse(storage.getItem(KEY)!).value).toBe('draft')
  })

  it('a save that lands after dispose() leaves the stored draft for the next queue', async () => {
    let resolve!: () => void
    const { q, storage, statuses } = setup(() => new Promise<void>((r) => (resolve = r)))
    q.update('draft')
    await vi.advanceTimersByTimeAsync(1200)
    const before = statuses.length
    const disposed = q.dispose()
    // a new queue for the same chapter now relies on this entry
    resolve()
    await disposed
    expect(JSON.parse(storage.getItem(KEY)!).value).toBe('draft')
    expect(statuses.length).toBe(before) // and reports nothing
  })

  it('dispose() resolves at once when nothing is in flight', async () => {
    const { q } = setup()
    await expect(q.dispose()).resolves.toBeUndefined()
  })

  it('keeps working when storage throws', async () => {
    const statuses: SaveStatus[] = []
    const save = vi.fn(() => Promise.resolve())
    const q = createSaveQueue<string>({
      key: 'k',
      save,
      isConflict: () => null,
      storage: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('quota')
        },
        removeItem: () => {
          throw new Error('denied')
        },
      },
      onStatus: (s) => statuses.push(s),
    })
    q.update('v')
    await vi.advanceTimersByTimeAsync(1200)
    expect(save).toHaveBeenCalledWith('v')
    expect(statuses[statuses.length - 1]?.state).toBe('saved')
  })
})

describe('restoreUnsaved', () => {
  it('returns the stored value', () => {
    const storage = memoryStorage()
    const q = createSaveQueue<string>({ key: 'chapter:one', save: () => Promise.resolve(), isConflict: () => null, storage, onStatus: () => {} })
    q.update('lost words')
    q.dispose()
    expect(restoreUnsaved<string>('chapter:one', storage)).toBe('lost words')
  })

  it('returns null when nothing is stored or the entry is corrupt', () => {
    const storage = memoryStorage()
    expect(restoreUnsaved('chapter:none', storage)).toBeNull()
    storage.setItem('loreloom:unsaved:chapter:bad', '{not json')
    expect(restoreUnsaved('chapter:bad', storage)).toBeNull()
  })
})

describe('formatSaveStatus', () => {
  const now = Date.parse('2026-11-02T10:00:00Z')
  it('uses the exact copy', () => {
    expect(formatSaveStatus({ state: 'saving' }, now)).toBe('Saving…')
    expect(formatSaveStatus({ state: 'saved', at: now - 10_000 }, now)).toBe('Saved · just now')
    expect(formatSaveStatus({ state: 'saved', at: now - 3 * 60_000 }, now)).toBe('Saved · 3 min ago')
    expect(formatSaveStatus({ state: 'error', message: 'offline' }, now)).toBe('Not saved: retry')
    expect(formatSaveStatus({ state: 'conflict', theirs: null }, now)).toBe('Changed elsewhere')
    // a save is already scheduled, so a pending edit reads as saving
    expect(formatSaveStatus({ state: 'dirty' }, now)).toBe('Saving…')
    expect(formatSaveStatus({ state: 'saved', at: now - 59_000 }, now)).toBe('Saved · just now')
    expect(formatSaveStatus({ state: 'saved', at: now - 61_000 }, now)).toBe('Saved · 1 min ago')
  })
})
