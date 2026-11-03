import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, expect, test } from 'vitest'
import { Book } from '@loreloom/core'
import { registerTools } from '../src/tools.ts'

const SAMPLE = resolve(import.meta.dirname, '../../../sample-book')
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean
    content: { type: string; text: string }[]
  }
  return { isError: res.isError === true, text: res.content[0]!.text }
}

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'loreloom-mcp-'))
  const book = await Book.createFromSample(dir, SAMPLE)
  const server = new McpServer({ name: 'loreloom', version: '0.1.0' })
  registerTools(server, book)
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
})

test('lists exactly the nine tools', async () => {
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      'add_relationship',
      'create_card',
      'get_stats',
      'list_cards',
      'list_chapters',
      'read_card',
      'read_chapter',
      'search_book',
      'update_card',
    ].sort(),
  )
})

test('no tool writes chapters', async () => {
  const { tools } = await client.listTools()
  for (const t of tools) {
    expect(t.name).not.toMatch(/chapter.*(create|update|write|save|delete|edit|append|insert|replace)|(create|update|write|save|delete|edit|append|insert|replace).*chapter/)
  }
})

test('search_book finds a chapter hit for ember', async () => {
  const r = await call('search_book', { query: 'ember' })
  expect(r.isError).toBe(false)
  const hits = JSON.parse(r.text) as { type: string; id: string; title: string; snippet: string }[]
  expect(hits.length).toBeLessThanOrEqual(20)
  expect(hits.some((h) => h.type === 'chapter')).toBe(true)
  expect(hits.every((h) => h.snippet.length <= 170)).toBe(true)
})

test('create_card then read_card round-trips', async () => {
  const c = await call('create_card', { kind: 'place', name: 'Hollow Keep', summary: 'A ruin', aliases: ['The Keep'] })
  expect(c.isError).toBe(false)
  const { id } = JSON.parse(c.text) as { id: string }
  const r = await call('read_card', { kind: 'place', id })
  const card = JSON.parse(r.text)
  expect(card).toMatchObject({ name: 'Hollow Keep', summary: 'A ruin', aliases: ['The Keep'] })
})

test('update_card changes the summary and body', async () => {
  const c = JSON.parse((await call('create_card', { kind: 'term', name: 'Glim' })).text) as { id: string }
  const u = await call('update_card', { kind: 'term', id: c.id, summary: 'light', body: 'More.', fields: { role: 'x' } })
  expect(u.isError).toBe(false)
  expect(JSON.parse(u.text)).toMatchObject({ summary: 'light', body: 'More.', fields: { role: 'x' } })
})

test('add_relationship links two characters', async () => {
  const chars = JSON.parse((await call('list_cards', { kind: 'character' })).text) as { id: string }[]
  const [a, b] = [chars[0]!.id, chars[1]!.id]
  const r = await call('add_relationship', { from: a, to: b, kind: 'rival', note: 'old feud' })
  expect(r.isError).toBe(false)
  expect(JSON.parse(r.text).relationships).toContainEqual({ to: b, kind: 'rival', note: 'old feud' })
})

test('list_chapters, read_chapter and get_stats work', async () => {
  const list = JSON.parse((await call('list_chapters')).text) as { id: string }[]
  expect(list.length).toBeGreaterThan(0)
  const ch = JSON.parse((await call('read_chapter', { id: list[0]!.id })).text)
  expect(ch.body).toBeTypeOf('string')
  expect(JSON.parse((await call('get_stats')).text).chapters).toBe(list.length)
})

test('book errors come back as isError results', async () => {
  expect((await call('read_chapter', { id: '../x' })).isError).toBe(true)
  expect((await call('read_chapter', { id: 'nope' })).isError).toBe(true)
  expect((await call('read_card', { kind: 'character', id: 'nope' })).isError).toBe(true)
  expect((await call('update_card', { kind: 'character', id: 'nope', summary: 'x' })).isError).toBe(true)
})
