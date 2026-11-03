import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeCodeProvider } from '../src/ai/claudeCode.ts'
import type { AiEvent, AiRunInput } from '../src/ai/provider.ts'

const FAKE = resolve(import.meta.dirname, 'fixtures', 'fake-claude.mjs')
const SID = '0b6f2c1e-4a8d-4e2b-9c3f-7d1a5e8b9f20'

async function setup(mode: string, opts: { statusTimeoutMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'loreloom-fake-'))
  const log = join(dir, 'log.jsonl')
  process.env.FAKE_CLAUDE_MODE = mode
  process.env.FAKE_CLAUDE_LOG = log
  const provider = new ClaudeCodeProvider({ command: process.execPath, commandArgs: [FAKE], ...opts })
  const lines = async (): Promise<Record<string, unknown>[]> =>
    (await readFile(log, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  const calls = async () => (await lines()).filter((l) => 'argv' in l) as { argv: string[]; stdin: string; pid: number }[]
  const input = (extra: Partial<AiRunInput> = {}): AiRunInput => ({
    mode: 'brainstorm',
    systemPrompt: 'SYS',
    prompt: 'the prompt',
    cwd: dir,
    ...extra,
  })
  return { provider, calls, lines, input, dir }
}

async function collect(it: AsyncIterable<AiEvent>): Promise<AiEvent[]> {
  const out: AiEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE
  delete process.env.FAKE_CLAUDE_LOG
})

describe('ClaudeCodeProvider.run', () => {
  it('maps the stream to events', async () => {
    const { provider, input } = await setup('ok')
    expect(await collect(provider.run(input(), new AbortController().signal))).toEqual([
      { type: 'session', sessionId: SID },
      { type: 'activity', text: 'Reading world/characters/kael.md' },
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', sessionId: SID },
    ])
  })

  it('passes a read-only tool set, no user settings, and the prompt over stdin', async () => {
    const { provider, input, calls } = await setup('ok')
    await collect(provider.run(input(), new AbortController().signal))
    const [call] = await calls()
    const a = call!.argv
    expect(call!.stdin).toBe('the prompt')
    expect(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 4)).toEqual(['--tools', 'Read', 'Grep', 'Glob'])
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('')
    expect(a).toContain('--strict-mcp-config')
    expect(a[a.indexOf('--append-system-prompt') + 1]).toBe('SYS')
    for (const bad of ['Write', 'Edit', 'Bash']) expect(a).not.toContain(bad)
    expect(a).not.toContain('--resume')
    expect(a).not.toContain('--no-session-persistence')
  })

  it('resumes a session and skips persistence in review mode', async () => {
    const { provider, input, calls } = await setup('ok')
    await collect(provider.run(input({ resumeSessionId: SID }), new AbortController().signal))
    await collect(provider.run(input({ mode: 'review' }), new AbortController().signal))
    const [first, second] = await calls()
    // `--resume=<id>` keeps the id from ever being parsed as a flag of its own.
    expect(first!.argv).toContain(`--resume=${SID}`)
    expect(first!.argv).not.toContain('--resume')
    expect(second!.argv).toContain('--no-session-persistence')
  })

  it('never passes a non-UUID session id to the CLI', async () => {
    const { provider, input, calls } = await setup('ok')
    await collect(provider.run(input({ resumeSessionId: '--dangerously-skip-permissions' }), new AbortController().signal))
    const [call] = await calls()
    expect(call!.argv.some((a) => a.startsWith('--resume'))).toBe(false)
    expect(call!.argv).not.toContain('--dangerously-skip-permissions')
  })

  it('lets the CLI exit on its own after the result, so the session is flushed', async () => {
    const { provider, input, lines } = await setup('flush')
    const events = await collect(provider.run(input(), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    expect((await lines()).some((l) => l.flushed === true)).toBe(true)
  })

  it('reports a usage limit as rate_limited', async () => {
    const { provider, input } = await setup('limit')
    const events = await collect(provider.run(input(), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'rate_limited' })
  })

  it('reports a crash as failed with the stderr tail', async () => {
    const { provider, input } = await setup('crash')
    const last = (await collect(provider.run(input(), new AbortController().signal))).at(-1)
    expect(last).toMatchObject({ type: 'error', code: 'failed' })
    expect((last as { message: string }).message).toContain('boom')
  })

  it('reports a missing command as not_installed', async () => {
    const p = new ClaudeCodeProvider({ command: 'definitely-not-a-command-xyz' })
    const { input } = await setup('ok')
    const last = (await collect(p.run(input(), new AbortController().signal))).at(-1)
    expect(last).toMatchObject({ type: 'error', code: 'not_installed' })
  })

  it('cancels, and leaves no orphaned child', async () => {
    const { provider, input, calls } = await setup('slow')
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 300)
    const events = await collect(provider.run(input(), ac.signal))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'cancelled' })
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

  it('kills the child when the consumer stops iterating early', async () => {
    const { provider, input, calls } = await setup('slow')
    for await (const e of provider.run(input(), new AbortController().signal)) {
      if (e.type === 'text') break
    }
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
})

describe('ClaudeCodeProvider.status', () => {
  it('not_installed when the command does not exist', async () => {
    expect(await new ClaudeCodeProvider({ command: 'definitely-not-a-command-xyz' }).status()).toEqual({
      available: false,
      reason: 'not_installed',
    })
  })
  it('not_logged_in when logged out', async () => {
    const { provider } = await setup('logged-out')
    expect(await provider.status()).toEqual({ available: false, reason: 'not_logged_in' })
  })
  it('available with the subscription type', async () => {
    const { provider } = await setup('ok')
    expect(await provider.status()).toEqual({ available: true, subscriptionType: 'pro' })
  })
  it('does not cache an unavailable answer', async () => {
    const { provider } = await setup('logged-out')
    expect(await provider.status()).toEqual({ available: false, reason: 'not_logged_in' })
    process.env.FAKE_CLAUDE_MODE = 'ok'
    expect(await provider.status()).toEqual({ available: true, subscriptionType: 'pro' })
  })
  it('reports a status timeout as unresponsive (not logged out) and does not cache it', async () => {
    const { provider } = await setup('hang-status', { statusTimeoutMs: 300 })
    expect(await provider.status()).toEqual({ available: false, reason: 'unresponsive' })
    process.env.FAKE_CLAUDE_MODE = 'ok'
    expect(await provider.status()).toEqual({ available: true, subscriptionType: 'pro' })
  })
  it('caches for 60 seconds', async () => {
    const { provider } = await setup('ok')
    await provider.status()
    // The fake now answers "logged out", but the cached answer is still served.
    process.env.FAKE_CLAUDE_MODE = 'logged-out'
    expect(await provider.status()).toEqual({ available: true, subscriptionType: 'pro' })
  })
})
