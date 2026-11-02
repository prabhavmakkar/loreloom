import { relative } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  Book,
  BookExistsError,
  CARD_DIRS,
  ConflictError,
  InvalidIdError,
  InvalidInputError,
  NotABookError,
  NotFoundError,
  bookStats,
} from '@loreloom/core'
import type { BookChange, CardKind } from '@loreloom/core'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AiProvider } from './ai/provider.ts'
import { localGuard } from './guard.ts'
import { watchBook } from './watcher.ts'
import type { BookWatcher } from './watcher.ts'

export interface AppOptions {
  bookDir: string
  sampleDir: string
  provider: AiProvider
  staticDir?: string
  /** Called once each time the book becomes available (opened or created). */
  onBookReady?: (book: Book) => void
}

type Obj = Record<string, unknown>

async function readObject(req: { json(): Promise<unknown> }): Promise<Obj> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new InvalidInputError('Request body must be JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidInputError('Request body must be a JSON object')
  }
  return body as Obj
}

function requireString(o: Obj, key: string): string {
  const v = o[key]
  if (typeof v !== 'string' || v.trim() === '') throw new InvalidInputError(`${key} must be a non-empty string`)
  return v
}

function requirePatch(o: Obj): Obj {
  const p = o.patch
  if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new InvalidInputError('patch must be an object')
  return p as Obj
}

function baseVersionOf(o: Obj): string | undefined {
  if (o.baseVersion === undefined) return undefined
  if (typeof o.baseVersion !== 'string') throw new InvalidInputError('baseVersion must be a string')
  return o.baseVersion
}

function cardKind(kind: string): CardKind {
  if (!Object.hasOwn(CARD_DIRS, kind)) throw new InvalidInputError(`Unknown card kind: ${kind}`)
  return kind as CardKind
}

const PING_MS = 25_000

export function createApp(opts: AppOptions): { app: Hono; getBook(): Book | null; close(): Promise<void> } {
  let book: Book | null = null
  let watcher: BookWatcher | null = null
  const clients = new Set<(c: BookChange) => void>()
  const aborters = new Set<() => void>()
  let opening: Promise<Book | null> | null = null

  const becomeReady = (b: Book): Book => {
    book = b
    void watcher?.close()
    watcher = watchBook(b, (change) => {
      for (const send of clients) send(change)
    })
    opts.onBookReady?.(b)
    return b
  }

  async function ensureBook(): Promise<Book | null> {
    if (book) return book
    opening ??= (async () => {
      try {
        return (await Book.isBook(opts.bookDir)) ? becomeReady(await Book.open(opts.bookDir)) : null
      } finally {
        opening = null
      }
    })()
    return opening
  }

  async function needBook(): Promise<Book> {
    const b = await ensureBook()
    if (!b) throw new NotABookError('No book yet')
    return b
  }

  const app = new Hono()
  app.use('*', localGuard())

  app.onError((err, c) => {
    if (err instanceof ConflictError) return c.json({ error: 'conflict', current: err.current }, 409)
    if (err instanceof NotFoundError) return c.json({ error: 'not_found', message: err.message }, 404)
    if (err instanceof InvalidIdError || err instanceof InvalidInputError) {
      return c.json({ error: 'invalid', message: err.message }, 400)
    }
    if (err instanceof NotABookError) return c.json({ error: 'no_book' }, 409)
    if (err instanceof BookExistsError) return c.json({ error: 'book_exists' }, 409)
    console.error(err)
    return c.json({ error: 'internal' }, 500)
  })

  // ---- book ----
  app.get('/api/book', async (c) => {
    const b = await ensureBook()
    return c.json(b ? { exists: true, meta: b.meta } : { exists: false })
  })

  app.post('/api/book', async (c) => {
    if (await ensureBook()) throw new BookExistsError('A book already exists')
    const body = await readObject(c.req)
    const created =
      body.sample === true
        ? await Book.createFromSample(opts.bookDir, opts.sampleDir)
        : await Book.create(opts.bookDir, { title: requireString(body, 'title'), author: requireString(body, 'author') })
    becomeReady(created)
    return c.json({ meta: created.meta }, 201)
  })

  app.patch('/api/book', async (c) => {
    const b = await needBook()
    const body = await readObject(c.req)
    const patch: { title?: string; author?: string; wordsPerPage?: number } = {}
    if (body.title !== undefined) patch.title = requireString(body, 'title')
    if (body.author !== undefined) {
      if (typeof body.author !== 'string') throw new InvalidInputError('author must be a string')
      patch.author = body.author
    }
    if (body.wordsPerPage !== undefined) {
      const w = body.wordsPerPage
      if (typeof w !== 'number' || !Number.isInteger(w) || w < 1) {
        throw new InvalidInputError('wordsPerPage must be an integer >= 1')
      }
      patch.wordsPerPage = w
    }
    return c.json({ meta: await b.updateMeta(patch) })
  })

  app.get('/api/stats', async (c) => c.json(await bookStats(await needBook())))

  // ---- chapters ----
  app.get('/api/chapters', async (c) => {
    const chapters = await (await needBook()).listChapters()
    return c.json(chapters.map(({ body: _body, ...rest }) => rest))
  })

  app.post('/api/chapters', async (c) => {
    const b = await needBook()
    const body = await readObject(c.req)
    return c.json(await b.createChapter({ title: requireString(body, 'title') }), 201)
  })

  app.put('/api/chapters/order', async (c) => {
    const b = await needBook()
    const { ids } = await readObject(c.req)
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string')) {
      throw new InvalidInputError('ids must be an array of strings')
    }
    const chapters = await b.reorderChapters(ids)
    return c.json(chapters.map(({ body: _body, ...rest }) => rest))
  })

  app.get('/api/chapters/:id', async (c) => c.json(await (await needBook()).getChapter(c.req.param('id'))))

  app.put('/api/chapters/:id', async (c) => {
    const b = await needBook()
    const body = await readObject(c.req)
    return c.json(await b.saveChapter(c.req.param('id'), requirePatch(body), baseVersionOf(body)))
  })

  app.delete('/api/chapters/:id', async (c) => {
    await (await needBook()).deleteChapter(c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---- cards ----
  app.get('/api/cards', async (c) => {
    const b = await needBook()
    const kind = c.req.query('kind')
    return c.json(await b.listCards(kind === undefined ? undefined : cardKind(kind)))
  })

  app.post('/api/cards/character/:id/relationships', async (c) => {
    const b = await needBook()
    const body = await readObject(c.req)
    const rel: { to: string; kind: string; note?: string } = { to: requireString(body, 'to'), kind: requireString(body, 'kind') }
    if (body.note !== undefined) {
      if (typeof body.note !== 'string') throw new InvalidInputError('note must be a string')
      rel.note = body.note
    }
    return c.json(await b.addRelationship(c.req.param('id'), rel))
  })

  app.delete('/api/cards/character/:id/relationships', async (c) => {
    const b = await needBook()
    const body = await readObject(c.req)
    return c.json(
      await b.removeRelationship(c.req.param('id'), { to: requireString(body, 'to'), kind: requireString(body, 'kind') }),
    )
  })

  app.post('/api/cards/:kind', async (c) => {
    const kind = cardKind(c.req.param('kind'))
    const b = await needBook()
    const body = await readObject(c.req)
    const input: { name: string; summary?: string; aliases?: string[] } = { name: requireString(body, 'name') }
    if (body.summary !== undefined) {
      if (typeof body.summary !== 'string') throw new InvalidInputError('summary must be a string')
      input.summary = body.summary
    }
    if (body.aliases !== undefined) {
      if (!Array.isArray(body.aliases) || !body.aliases.every((a) => typeof a === 'string')) {
        throw new InvalidInputError('aliases must be an array of strings')
      }
      input.aliases = body.aliases
    }
    return c.json(await b.createCard(kind, input), 201)
  })

  app.get('/api/cards/:kind/:id', async (c) => {
    const kind = cardKind(c.req.param('kind'))
    return c.json(await (await needBook()).getCard(kind, c.req.param('id')))
  })

  app.put('/api/cards/:kind/:id', async (c) => {
    const kind = cardKind(c.req.param('kind'))
    const b = await needBook()
    const body = await readObject(c.req)
    return c.json(await b.saveCard(kind, c.req.param('id'), requirePatch(body), baseVersionOf(body)))
  })

  app.delete('/api/cards/:kind/:id', async (c) => {
    const kind = cardKind(c.req.param('kind'))
    await (await needBook()).deleteCard(kind, c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---- external changes (SSE) ----
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: BookChange[] = []
      let wake: (() => void) | null = null
      let closed = false
      const push = (change: BookChange) => {
        queue.push(change)
        wake?.()
      }
      const stop = () => {
        closed = true
        wake?.()
      }
      clients.add(push)
      aborters.add(stop)
      stream.onAbort(stop)
      try {
        await stream.writeSSE({ event: 'ready', data: '{}' })
        let lastPing = Date.now()
        while (!closed) {
          const change = queue.shift()
          if (change) {
            await stream.writeSSE({ event: 'change', data: JSON.stringify(change) })
            continue
          }
          const wait = Math.max(0, PING_MS - (Date.now() - lastPing))
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, wait)
            wake = () => {
              clearTimeout(t)
              resolve()
            }
          })
          wake = null
          if (!closed && queue.length === 0 && Date.now() - lastPing >= PING_MS) {
            await stream.writeSSE({ event: 'ping', data: '' })
            lastPing = Date.now()
          }
        }
      } finally {
        clients.delete(push)
        aborters.delete(stop)
      }
    }),
  )

  // ---- AI ----
  app.get('/api/ai/status', async (c) => c.json(await opts.provider.status()))

  // ---- unknown API routes never fall through to the SPA ----
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  // ---- static files (production build) ----
  if (opts.staticDir) {
    const root = relative(process.cwd(), opts.staticDir) || '.'
    app.use('*', serveStatic({ root }))
    app.get('*', serveStatic({ root, path: 'index.html' }))
  }

  const close = async (): Promise<void> => {
    for (const stop of aborters) stop()
    const w = watcher
    watcher = null
    await w?.close()
  }

  return { app, getBook: () => book, close }
}
