import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Res } from './helpers.ts'
import { makeApp, SAMPLE_DIR } from './helpers.ts'

describe('book lifecycle', () => {
  it('reports no book, then creates the sample', async () => {
    const { req, getBook } = await makeApp()
    expect(await (await req('GET', '/api/book')).json()).toEqual({ exists: false })
    expect(getBook()).toBeNull()
    const res = await req('POST', '/api/book', { sample: true })
    expect(res.status).toBe(201)
    expect((await res.json()).meta.title).toBeTruthy()
    expect((await (await req('GET', '/api/chapters')).json()).length).toBe(3)
    expect((await (await req('GET', '/api/stats')).json()).chapters).toBe(3)
    expect((await req('POST', '/api/book', { sample: true })).status).toBe(409)
    expect(getBook()).not.toBeNull()
  })

  it('creates a blank book from title and author and rejects bad input', async () => {
    const { req } = await makeApp()
    expect((await req('POST', '/api/book', { title: '' })).status).toBe(400)
    const res = await req('POST', '/api/book', { title: 'Ash', author: 'Me' })
    expect(res.status).toBe(201)
    expect((await res.json()).meta).toMatchObject({ title: 'Ash', author: 'Me' })
  })

  it('opens an existing book lazily and fires onBookReady once', async () => {
    const onBookReady = vi.fn()
    const first = await makeApp()
    await first.req('POST', '/api/book', { title: 'T', author: 'A' })
    const { createApp } = await import('../src/app.ts')
    const { stubProvider } = await import('./helpers.ts')
    const again = createApp({ bookDir: first.bookDir, sampleDir: SAMPLE_DIR, provider: stubProvider, onBookReady })
    const [a, b] = await Promise.all([
      again.app.request('/api/book', { headers: { 'X-Loreloom': '1' } }) as Promise<Res>,
      again.app.request('/api/book', { headers: { 'X-Loreloom': '1' } }) as Promise<Res>,
    ])
    expect((await a.json()).exists).toBe(true)
    expect((await b.json()).exists).toBe(true)
    expect(onBookReady).toHaveBeenCalledTimes(1)
  })

  it('fires onBookReady when created', async () => {
    const onBookReady = vi.fn()
    const { req } = await makeApp({ onBookReady })
    await req('POST', '/api/book', { title: 'T', author: 'A' })
    expect(onBookReady).toHaveBeenCalledTimes(1)
  })

  it('returns 409 no_book for book routes before a book exists', async () => {
    const { req } = await makeApp()
    const res = await req('GET', '/api/chapters')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_book' })
  })

  it('PATCH validates wordsPerPage', async () => {
    const { req } = await makeApp()
    await req('POST', '/api/book', { title: 'T', author: 'A' })
    for (const bad of [0, -5, 1.5, '250', null]) {
      expect((await req('PATCH', '/api/book', { wordsPerPage: bad })).status, String(bad)).toBe(400)
    }
    const ok = await req('PATCH', '/api/book', { wordsPerPage: 300, title: 'New' })
    expect(ok.status).toBe(200)
    expect((await ok.json()).meta).toMatchObject({ wordsPerPage: 300, title: 'New' })
  })

  it('stays usable if the book dir exists but is empty', async () => {
    const { req, bookDir } = await makeApp()
    await mkdir(bookDir, { recursive: true })
    expect(await (await req('GET', '/api/book')).json()).toEqual({ exists: false })
    await rm(bookDir, { recursive: true })
  })
})

describe('chapters', () => {
  it('creates, lists without body, saves, conflicts, reorders, deletes', async () => {
    const { req } = await makeApp()
    await req('POST', '/api/book', { title: 'T', author: 'A' })
    const created = await req('POST', '/api/chapters', { title: 'One' })
    expect(created.status).toBe(201)
    const ch = await created.json()
    await req('POST', '/api/chapters', { title: 'Two' })

    const list = await (await req('GET', '/api/chapters')).json()
    expect(list).toHaveLength(2)
    expect(list[0]).not.toHaveProperty('body')

    const saved = await (await req('PUT', `/api/chapters/${ch.id}`, { patch: { body: 'hello' }, baseVersion: ch.version })).json()
    expect(saved.body).toBe('hello')

    const stale = await req('PUT', `/api/chapters/${ch.id}`, { patch: { body: 'x' }, baseVersion: ch.version })
    expect(stale.status).toBe(409)
    const conflict = await stale.json()
    expect(conflict.error).toBe('conflict')
    expect(conflict.current.version).toBe(saved.version)

    const order = await req('PUT', '/api/chapters/order', { ids: list.map((c: { id: string }) => c.id).reverse() })
    expect(order.status).toBe(200)
    expect((await req('PUT', '/api/chapters/order', { ids: ['nope'] })).status).toBe(400)
    expect((await req('PUT', `/api/chapters/${ch.id}`, {})).status).toBe(400)

    expect((await req('DELETE', `/api/chapters/${ch.id}`)).status).toBe(200)
    expect((await req('GET', `/api/chapters/${ch.id}`)).status).toBe(404)
  })

  it('answers 400 with a message for a chapter whose header cannot be read, and lists the rest', async () => {
    const { req, bookDir } = await makeApp()
    await req('POST', '/api/book', { sample: true })
    await writeFile(join(bookDir, 'chapters', 'broken.md'), '---\ntitle: [unclosed\n---\nText')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const list = await req('GET', '/api/chapters')
    warn.mockRestore()
    expect(list.status).toBe(200)
    expect((await list.json()).map((c: { id: string }) => c.id)).not.toContain('broken')
    const res = await req('GET', '/api/chapters/broken')
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/header/i)
  })

  it('rejects malformed JSON with 400', async () => {
    const { app, req } = await makeApp()
    await req('POST', '/api/book', { title: 'T', author: 'A' })
    const res = await app.request('/api/chapters', {
      method: 'POST',
      headers: { 'X-Loreloom': '1' },
      body: '{nope',
    })
    expect(res.status).toBe(400)
  })

  it('rejects path traversal ids with 400 (review focus #5)', async () => {
    const { req } = await makeApp()
    await req('POST', '/api/book', { sample: true })
    for (const id of ['..%2F..%2Fetc', '..%2Fbook', '%2Fetc%2Fpasswd', '..%5C..%5Cx', '.hidden', '%00']) {
      expect((await req('GET', `/api/chapters/${id}`)).status, id).toBe(400)
      expect((await req('PUT', `/api/chapters/${id}`, { patch: { body: 'x' } })).status, id).toBe(400)
      expect((await req('DELETE', `/api/chapters/${id}`)).status, id).toBe(400)
      expect((await req('GET', `/api/cards/character/${id}`)).status, id).toBe(400)
      expect((await req('DELETE', `/api/cards/character/${id}`)).status, id).toBe(400)
    }
  })
})

describe('cards', () => {
  it('rejects unknown kinds with 400', async () => {
    const { req } = await makeApp()
    await req('POST', '/api/book', { sample: true })
    expect((await req('GET', '/api/cards?kind=dragon')).status).toBe(400)
    expect((await req('POST', '/api/cards/dragon', { name: 'x' })).status).toBe(400)
    expect((await req('GET', '/api/cards/constructor/x')).status).toBe(400)
    expect((await req('GET', '/api/cards/__proto__/x')).status).toBe(400)
  })

  it('lists, creates, saves with conflict, relates and deletes', async () => {
    const { req } = await makeApp()
    await req('POST', '/api/book', { title: 'T', author: 'A' })
    expect(await (await req('GET', '/api/cards?kind=place')).json()).toEqual([])
    const a = await (await req('POST', '/api/cards/character', { name: 'Ana', aliases: ['A'] })).json()
    const b = await (await req('POST', '/api/cards/character', { name: 'Bo' })).json()
    expect(a.id).toBe('ana')
    expect((await req('POST', '/api/cards/place', { name: '' })).status).toBe(400)

    const saved = await (await req('PUT', '/api/cards/character/ana', { patch: { summary: 's' }, baseVersion: a.version })).json()
    expect(saved.summary).toBe('s')
    const stale = await req('PUT', '/api/cards/character/ana', { patch: { summary: 't' }, baseVersion: a.version })
    expect(stale.status).toBe(409)
    expect((await stale.json()).current.summary).toBe('s')

    const rel = await req('POST', '/api/cards/character/ana/relationships', { to: b.id, kind: 'ally' })
    expect((await rel.json()).relationships).toEqual([{ to: 'bo', kind: 'ally' }])
    expect((await req('POST', '/api/cards/character/ana/relationships', { to: 'ghost', kind: 'ally' })).status).toBe(404)
    const removed = await req('DELETE', '/api/cards/character/ana/relationships', { to: 'bo', kind: 'ally' })
    expect((await removed.json()).relationships).toEqual([])

    expect((await req('GET', '/api/cards')).status).toBe(200)
    expect((await req('DELETE', '/api/cards/character/bo')).status).toBe(200)
    expect((await req('GET', '/api/cards/character/bo')).status).toBe(404)
  })
})

describe('misc', () => {
  it('serves AI status from the provider', async () => {
    const { req } = await makeApp()
    expect(await (await req('GET', '/api/ai/status')).json()).toEqual({ available: false, reason: 'not_installed' })
  })

  it('unknown /api routes 404', async () => {
    const { req } = await makeApp()
    expect((await req('GET', '/api/nope')).status).toBe(404)
  })

  it('serves static files with SPA fallback, but never for /api', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const staticDir = await mkdtemp(join(tmpdir(), 'loreloom-static-'))
    await writeFile(join(staticDir, 'index.html'), '<h1>spa</h1>')
    await writeFile(join(staticDir, 'a.js'), 'console.log(1)')
    const { app } = await makeApp({ staticDir })
    expect(await (await app.request('/a.js')).text()).toBe('console.log(1)')
    expect(await (await app.request('/some/route')).text()).toBe('<h1>spa</h1>')
    expect(await (await app.request('/')).text()).toBe('<h1>spa</h1>')
    expect((await app.request('/api/nope', { headers: { 'X-Loreloom': '1' } })).status).toBe(404)
  })
})
