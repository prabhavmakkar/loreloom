import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { bookStats } from '@loreloom/core'
import type { Book, CardKind } from '@loreloom/core'
import { z } from 'zod'

const kindSchema = z.enum(['character', 'place', 'rule', 'term']).describe('Card kind: character | place | rule | term')
const KINDS = 'character|place|rule|term'
const MAX_HITS = 20
const CONTEXT = 80

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: true }

/** Wraps a handler so any failure (including Book errors) becomes an isError result instead of a throw. */
async function respond(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run(), null, 2) }] }
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
  }
}

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT)
  const end = Math.min(text.length, index + length + CONTEXT)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

interface Hit {
  type: 'chapter' | 'card'
  kind?: CardKind
  id: string
  title: string
  snippet: string
}

async function searchBook(book: Book, query: string): Promise<Hit[]> {
  const needle = query.toLowerCase()
  const hits: Hit[] = []
  const find = (text: string): string | null => {
    const i = text.toLowerCase().indexOf(needle)
    return i < 0 ? null : snippet(text, i, needle.length)
  }
  for (const c of await book.listChapters()) {
    const s = find(c.body)
    if (s !== null) hits.push({ type: 'chapter', id: c.id, title: c.title, snippet: s })
  }
  for (const c of await book.listCards()) {
    const s = find(c.name) ?? find(c.summary) ?? find(c.body)
    if (s !== null) hits.push({ type: 'card', kind: c.kind, id: c.id, title: c.name, snippet: s })
  }
  return hits.slice(0, MAX_HITS)
}

export function registerTools(server: McpServer, book: Book): void {
  server.registerTool(
    'list_chapters',
    { description: 'List the book\'s chapters in order, with id, title, status and summary.', inputSchema: {} },
    () =>
      respond(async () =>
        (await book.listChapters()).map(({ id, title, order, status, summary }) => ({ id, title, order, status, summary })),
      ),
  )

  server.registerTool(
    'read_chapter',
    {
      description:
        'Read one chapter (title, status, summary and full Markdown text) by id. Chapters are read-only through this server.',
      inputSchema: { id: z.string().describe('Chapter id, as returned by list_chapters') },
    },
    ({ id }) => respond(() => book.getChapter(id)),
  )

  server.registerTool(
    'list_cards',
    {
      description: `List world cards (id, name, summary), optionally only one kind (${KINDS}).`,
      inputSchema: { kind: kindSchema.optional() },
    },
    ({ kind }) =>
      respond(async () =>
        (await book.listCards(kind)).map(({ kind, id, name, summary }) => ({ kind, id, name, summary })),
      ),
  )

  server.registerTool(
    'read_card',
    {
      description: `Read one world card in full: name, aliases, summary, body, relationships and extra fields. kind is one of ${KINDS}.`,
      inputSchema: { kind: kindSchema, id: z.string().describe('Card id, as returned by list_cards') },
    },
    ({ kind, id }) => respond(() => book.getCard(kind, id)),
  )

  server.registerTool(
    'search_book',
    {
      description: `Case-insensitive text search across chapter text and card name, summary and body. Returns up to ${MAX_HITS} hits as {type, kind?, id, title, snippet}.`,
      inputSchema: { query: z.string().min(1).describe('Text to look for') },
    },
    ({ query }) => respond(() => searchBook(book, query)),
  )

  server.registerTool(
    'get_stats',
    {
      description: 'Word and page counts for the whole book and per chapter, plus how many cards of each kind exist.',
      inputSchema: {},
    },
    () => respond(() => bookStats(book)),
  )

  server.registerTool(
    'create_card',
    {
      description: `Create a new world card of kind ${KINDS}. The id is generated from the name. Returns the new card.`,
      inputSchema: {
        kind: kindSchema,
        name: z.string().min(1),
        summary: z.string().optional(),
        aliases: z.array(z.string()).optional(),
      },
    },
    ({ kind, name, summary, aliases }) =>
      respond(() => {
        const input: { name: string; summary?: string; aliases?: string[] } = { name }
        if (summary !== undefined) input.summary = summary
        if (aliases !== undefined) input.aliases = aliases
        return book.createCard(kind, input)
      }),
  )

  server.registerTool(
    'update_card',
    {
      description: `Update an existing world card (kind ${KINDS}). Only the fields you pass are changed; the rest is kept. Last write wins, so read the card first. 'fields' replaces the card's extra frontmatter fields as a whole.`,
      inputSchema: {
        kind: kindSchema,
        id: z.string(),
        summary: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        body: z.string().optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ kind, id, summary, aliases, body, fields }) =>
      respond(() => {
        const patch: Record<string, unknown> = {}
        if (summary !== undefined) patch.summary = summary
        if (aliases !== undefined) patch.aliases = aliases
        if (body !== undefined) patch.body = body
        if (fields !== undefined) patch.fields = fields
        return book.saveCard(kind, id, patch)
      }),
  )

  server.registerTool(
    'add_relationship',
    {
      description:
        'Add a relationship from one character to another (both are character ids), e.g. kind "sister" or "rival", with an optional note. Duplicates are ignored.',
      inputSchema: {
        from: z.string().describe('Character id the relationship starts from'),
        to: z.string().describe('Character id it points to'),
        kind: z.string().min(1),
        note: z.string().optional(),
      },
    },
    ({ from, to, kind, note }) =>
      respond(() => book.addRelationship(from, note === undefined ? { to, kind } : { to, kind, note })),
  )
}
