import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeCodeProvider } from '../src/ai/claudeCode.ts'
import { makeApp } from './helpers.ts'

const FAKE = resolve(import.meta.dirname, 'fixtures', 'fake-claude.mjs')
const SID = '0b6f2c1e-4a8d-4e2b-9c3f-7d1a5e8b9f20'

async function setup(mode = 'ok') {
  const log = join(await mkdtemp(join(tmpdir(), 'loreloom-airoutes-')), 'log.jsonl')
  process.env.FAKE_CLAUDE_MODE = mode
  process.env.FAKE_CLAUDE_LOG = log
  const provider = new ClaudeCodeProvider({ command: process.execPath, commandArgs: [FAKE] })
  const t = await makeApp({ provider })
  await t.req('POST', '/api/book', { sample: true })
  const calls = async (): Promise<{ argv: string[]; stdin: string; pid: number }[]> =>
    (await readFile(log, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  return { ...t, calls }
}

function parseSse(text: string): { event: string; data: any }[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n')
      return {
        event: lines.find((l) => l.startsWith('event:'))!.slice(6).trim(),
        data: JSON.parse(lines.find((l) => l.startsWith('data:'))!.slice(5)),
      }
    })
}

afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE
  delete process.env.FAKE_CLAUDE_LOG
})

describe('/api/ai', () => {
  it('streams a brainstorm run and remembers the session', async () => {
    const { req, bookDir, calls } = await setup()
    const res = await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'Ideas?' })
    expect(res.status).toBe(200)
    const events = parseSse(await res.text()).map((e) => e.data)
    expect(events.map((e) => e.type)).toEqual(['start', 'session', 'activity', 'text', 'text', 'done'])
    expect(typeof events[0].requestId).toBe('string')
    const stored = JSON.parse(await readFile(join(bookDir, '.loreloom', 'sessions.json'), 'utf8'))
    expect(stored.brainstorm).toBe(SID)

    const [first] = await calls()
    expect(first!.stdin).toContain('\n\n## Request\nIdeas?')
    expect(first!.argv.some((a) => a.startsWith('--resume'))).toBe(false)

    await (await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'More' })).text()
    const second = (await calls())[1]!
    expect(second.argv).toContain(`--resume=${SID}`)
    expect(second.stdin).toContain('## Request\nMore')

    await (await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'Fresh', newConversation: true })).text()
    expect((await calls())[2]!.argv.some((a) => a.startsWith('--resume'))).toBe(false)
  })

  it('does not store review sessions', async () => {
    const { req, bookDir } = await setup()
    await (await req('POST', '/api/ai/run', { mode: 'review', message: 'Review it' })).text()
    const stored = JSON.parse(await readFile(join(bookDir, '.loreloom', 'sessions.json'), 'utf8').catch(() => '{}'))
    expect(stored.review).toBeUndefined()
  })

  it('DELETE session clears it', async () => {
    const { req, bookDir } = await setup()
    await (await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'Ideas' })).text()
    expect((await req('DELETE', '/api/ai/session/brainstorm')).status).toBe(200)
    const stored = JSON.parse(await readFile(join(bookDir, '.loreloom', 'sessions.json'), 'utf8'))
    expect(stored.brainstorm).toBeUndefined()
    expect((await req('DELETE', '/api/ai/session/review')).status).toBe(400)
    expect((await req('DELETE', '/api/ai/session/draft')).status).toBe(400)
  })

  it('runs every Draft fresh: no --resume, no stored session, no persistence', async () => {
    const { req, bookDir, calls } = await setup()
    await (await req('POST', '/api/ai/run', { mode: 'draft', message: 'Write' })).text()
    await (await req('POST', '/api/ai/run', { mode: 'draft', message: 'Again' })).text()
    for (const call of await calls()) {
      expect(call.argv.some((a) => a.startsWith('--resume'))).toBe(false)
      expect(call.argv).toContain('--no-session-persistence')
    }
    const stored = JSON.parse(await readFile(join(bookDir, '.loreloom', 'sessions.json'), 'utf8').catch(() => '{}'))
    expect(stored.draft).toBeUndefined()
  })

  it('retries a stale Brainstorm resume once, fresh, without showing the failure', async () => {
    const { req, bookDir, calls } = await setup('stale-resume')
    await (await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'First' })).text()
    const events = parseSse(await (await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'Second' })).text()).map((e) => e.data)
    const [, resumed, fresh] = await calls()
    expect(resumed!.argv).toContain(`--resume=${SID}`)
    expect(fresh!.argv.some((a) => a.startsWith('--resume'))).toBe(false)
    expect(fresh!.stdin).toContain('## Request\nSecond')
    expect(events.filter((e) => e.type === 'start')).toHaveLength(1)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.at(-1).type).toBe('done')
    const stored = JSON.parse(await readFile(join(bookDir, '.loreloom', 'sessions.json'), 'utf8'))
    expect(stored.brainstorm).toBe(SID)
  })

  it('cancel aborts a running request', async () => {
    const { req } = await setup('slow')
    const res = await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'go' })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (!buf.includes('"requestId"')) {
      const r = await reader.read()
      if (r.done) throw new Error(`stream ended before the start event: ${buf}`)
      buf += dec.decode(r.value)
    }
    const requestId = JSON.parse(buf.match(/data: (\{"type":"start".*\})/)![1]!).requestId
    expect((await req('POST', '/api/ai/cancel', { requestId })).status).toBe(200)
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rest += dec.decode(value)
    }
    expect(buf + rest).toContain('"code":"cancelled"')
  })

  it('aborts the run when the client disconnects', async () => {
    const { req, calls } = await setup('slow')
    const res = await req('POST', '/api/ai/run', { mode: 'brainstorm', message: 'go' })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (!buf.includes('"type":"text"')) {
      const r = await reader.read()
      if (r.done) throw new Error(`stream ended early: ${buf}`)
      buf += dec.decode(r.value)
    }
    await reader.cancel()
    const [call] = await calls()
    const deadline = Date.now() + 4000
    let alive = true
    while (alive && Date.now() < deadline) {
      try {
        process.kill(call!.pid, 0)
        await new Promise((r) => setTimeout(r, 50))
      } catch {
        alive = false
      }
    }
    expect(alive).toBe(false)
  })

  it('validates input', async () => {
    const { req } = await setup()
    expect((await req('POST', '/api/ai/run', { mode: 'nope', message: 'x' })).status).toBe(400)
    expect((await req('POST', '/api/ai/run', { mode: 'draft', message: '' })).status).toBe(400)
    expect((await req('POST', '/api/ai/cancel', {})).status).toBe(400)
  })

  it('turns a review reply into suggestion events, never raw text', async () => {
    const { req, calls } = await setup('review')
    const res = await req('POST', '/api/ai/run', { mode: 'review', message: 'Review', chapterId: 'x' })
    const events = parseSse(await res.text()).map((e) => e.data)
    expect(events.some((e) => e.type === 'text')).toBe(false)
    expect(events.filter((e) => e.type === 'suggestion').map((e) => [e.suggestion.id, e.suggestion.category, e.suggestion.fix])).toEqual([
      ['r1', 'continuity', 'Kael picked the lock.'],
      ['r2', 'prose', ''],
    ])
    expect(events.at(-1).type).toBe('done')
    expect((await calls())[0]!.argv).toContain('--no-session-persistence')
  })
})
