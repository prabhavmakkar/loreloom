import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import type { Server } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { AiProvider } from './ai/provider.ts'
import { createApp } from './app.ts'

const HOST = '127.0.0.1'
const FIRST_PORT = 4317
const LAST_PORT = 4327

function listen(app: Hono, port: number): Promise<Server> {
  return new Promise((resolveListen, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: HOST }) as Server
    server.once('listening', () => resolveListen(server))
    server.once('error', reject)
  })
}

async function listenOnFreePort(app: Hono): Promise<number> {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    try {
      await listen(app, port)
      return port
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    }
  }
  throw new Error(`No free port between ${FIRST_PORT} and ${LAST_PORT}`)
}

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

// Placeholder until the real provider lands (Task 6).
const unavailableProvider: AiProvider = {
  status: async () => ({ available: false, reason: 'not_installed' }),
  async *run() {},
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const noOpen = args.includes('--no-open')
  const dirArg = args.find((a) => !a.startsWith('--'))
  const bookDir = resolve(dirArg ?? process.env.LORELOOM_BOOK ?? join(homedir(), 'Loreloom', 'my-book'))
  mkdirSync(bookDir, { recursive: true })

  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '..', '..', '..')
  const { app, close } = createApp({
    bookDir,
    sampleDir: join(repoRoot, 'sample-book'),
    provider: unavailableProvider,
  })

  process.once('SIGINT', () => void close().finally(() => process.exit(0)))
  const port = await listenOnFreePort(app)
  const url = `http://${HOST}:${port}`
  console.log(`Loreloom is open at ${url}  (book: ${bookDir})`)
  if (!noOpen) openBrowser(url)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
