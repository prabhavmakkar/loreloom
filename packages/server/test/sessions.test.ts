import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionStore } from '../src/ai/sessions.ts'

const UUID = '0b6f2c1e-4a8d-4e2b-9c3f-7d1a5e8b9f20'

describe('SessionStore', () => {
  it('ignores a stored id that is not a UUID (the file may be synced or hand-edited)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loreloom-sessions-'))
    await mkdir(join(dir, '.loreloom'))
    await writeFile(join(dir, '.loreloom', 'sessions.json'), JSON.stringify({ brainstorm: '--some-flag' }))
    expect(await new SessionStore(dir).get('brainstorm')).toBeUndefined()
  })

  it('refuses to store a non-UUID id and keeps a valid one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loreloom-sessions-'))
    const store = new SessionStore(dir)
    await store.set('brainstorm', UUID)
    await store.set('brainstorm', '--evil')
    expect(await store.get('brainstorm')).toBe(UUID)
    expect(JSON.parse(await readFile(join(dir, '.loreloom', 'sessions.json'), 'utf8')).brainstorm).toBe(UUID)
  })
})
