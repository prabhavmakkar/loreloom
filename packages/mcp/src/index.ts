import { resolve } from 'node:path'
import { Book } from '@loreloom/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.ts'

async function main(): Promise<void> {
  const arg = process.argv[2] ?? process.env.LORELOOM_BOOK
  if (!arg) {
    console.error('Usage: loreloom-mcp <book-dir>  (or set LORELOOM_BOOK)')
    process.exit(1)
  }
  const book = await Book.open(resolve(arg))
  const server = new McpServer({ name: 'loreloom', version: '0.1.0' })
  registerTools(server, book)
  await server.connect(new StdioServerTransport())
  console.error(`loreloom MCP server ready: ${book.meta.title || book.dir}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
