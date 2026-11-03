import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@loreloom/core'
import type { AiMode } from './provider.ts'

type Stored = 'brainstorm' | 'draft'
const isStored = (m: AiMode): m is Stored => m === 'brainstorm' || m === 'draft'
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only real Claude Code session ids (UUIDs) are accepted, so a synced or hand-edited file can never inject CLI flags. */
export const isSessionId = (id: unknown): id is string => typeof id === 'string' && SESSION_ID_RE.test(id)

/** Remembers the Claude Code session per mode in `.loreloom/sessions.json`. Review is never stored. */
export class SessionStore {
  private readonly file: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(bookDir: string) {
    this.file = join(bookDir, '.loreloom', 'sessions.json')
  }

  private async read(): Promise<Partial<Record<Stored, string>>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Record<Stored, string>>) : {}
    } catch {
      return {}
    }
  }

  async get(mode: AiMode): Promise<string | undefined> {
    if (!isStored(mode)) return undefined
    const id = (await this.read())[mode]
    return isSessionId(id) ? id : undefined
  }

  set(mode: AiMode, id: string): Promise<void> {
    if (!isSessionId(id)) return Promise.resolve()
    return this.update(mode, id)
  }

  clear(mode: AiMode): Promise<void> {
    return this.update(mode, undefined)
  }

  private update(mode: AiMode, id: string | undefined): Promise<void> {
    if (!isStored(mode)) return Promise.resolve()
    const next = this.queue.then(async () => {
      const data = await this.read()
      if (id === undefined) delete data[mode]
      else data[mode] = id
      await mkdir(join(this.file, '..'), { recursive: true })
      await writeFileAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`)
    })
    this.queue = next.catch(() => {})
    return next
  }
}
