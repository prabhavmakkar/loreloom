import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Book } from '@loreloom/core'
import type { BookChange } from '@loreloom/core'
import { watchBook } from '../src/watcher.ts'
import type { BookWatcher } from '../src/watcher.ts'
import { makeApp } from './helpers.ts'

const closers: BookWatcher[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((w) => w.close()))
})

async function setup() {
  const { bookDir } = await makeApp()
  const book = await Book.create(bookDir, { title: 'T', author: 'A' })
  const ch = await book.createChapter({ title: 'One' })
  const changes: BookChange[] = []
  const w = watchBook(book, (c) => changes.push(c))
  closers.push(w)
  await w.ready
  const waitFor = async (pred: (c: BookChange) => boolean, ms = 2000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const hit = changes.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`no matching change within ${ms}ms; got ${JSON.stringify(changes)}`)
  }
  return { book, ch, changes, waitFor, bookDir }
}

describe('watchBook', () => {
  it('reports an external chapter write', async () => {
    const { bookDir, ch, waitFor } = await setup()
    await writeFile(join(bookDir, 'chapters', `${ch.id}.md`), '---\ntitle: One\norder: 1\n---\nexternal edit\n')
    expect(await waitFor((c) => c.type === 'chapter')).toEqual({ type: 'chapter', id: ch.id })
  })

  it('ignores its own saves', async () => {
    const { book, ch, changes } = await setup()
    await book.saveChapter(ch.id, { body: 'mine' })
    await new Promise((r) => setTimeout(r, 1000))
    expect(changes).toEqual([])
  })

  it('reports an external card write with kind and id', async () => {
    const { bookDir, waitFor } = await setup()
    await writeFile(join(bookDir, 'world', 'characters', 'kael.md'), '---\nname: Kael\n---\nhi\n')
    expect(await waitFor((c) => c.type === 'card')).toEqual({ type: 'card', kind: 'character', id: 'kael' })
  })

  it('reports an external delete', async () => {
    const { bookDir, ch, waitFor } = await setup()
    await rm(join(bookDir, 'chapters', `${ch.id}.md`))
    expect(await waitFor((c) => c.deleted === true)).toEqual({ type: 'chapter', id: ch.id, deleted: true })
  })

  it('ignores .loreloom and temp files', async () => {
    const { bookDir, changes } = await setup()
    await mkdir(join(bookDir, '.loreloom'), { recursive: true })
    await writeFile(join(bookDir, '.loreloom', 'x.md'), 'x')
    await writeFile(join(bookDir, 'chapters', 'a.md.tmp'), 'x')
    await new Promise((r) => setTimeout(r, 700))
    expect(changes).toEqual([])
  })
})

describe('GET /api/events', () => {
  it('streams external changes to SSE clients and closes cleanly', async () => {
    const { app, req, close, bookDir } = await makeApp()
    await req('POST', '/api/book', { title: 'T', author: 'A' })
    const res = await app.request('/api/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let text = ''
    const readUntil = async (needle: string) => {
      const end = Date.now() + 3000
      while (!text.includes(needle) && Date.now() < end) {
        const r = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 3000))])
        if (!r || r.done) break
        text += dec.decode(r.value)
      }
      expect(text).toContain(needle)
    }
    await readUntil('event: ready')
    await new Promise((r) => setTimeout(r, 300)) // let the watcher finish its initial scan
    await writeFile(join(bookDir, 'world', 'places', 'keep.md'), '---\nname: Keep\n---\n')
    await readUntil('event: change')
    await readUntil('"id":"keep"')
    await close()
    expect((await reader.read()).done).toBe(true)
  })
})
