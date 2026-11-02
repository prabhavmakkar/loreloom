import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AiProvider } from '../src/ai/provider.ts'
import { createApp } from '../src/app.ts'

export const stubProvider: AiProvider = {
  status: async () => ({ available: false, reason: 'not_installed' }),
  async *run() {},
}

/** Response whose json() is loosely typed, for terse assertions. */
export type Res = Omit<Response, 'json'> & { json(): Promise<any> } // eslint-disable-line @typescript-eslint/no-explicit-any

export const SAMPLE_DIR = resolve(import.meta.dirname, '..', '..', '..', 'sample-book')

export async function makeApp(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'loreloom-server-'))
  const bookDir = join(root, 'book')
  const made = createApp({ bookDir, sampleDir: SAMPLE_DIR, provider: stubProvider, ...extra })
  const H = { 'X-Loreloom': '1', 'Content-Type': 'application/json' }
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> =>
    Promise.resolve(made.app.request(path, {
      method,
      headers: { ...H, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as Promise<Res>)
  return { ...made, bookDir, req }
}
