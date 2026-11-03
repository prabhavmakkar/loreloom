#!/usr/bin/env node
// Stand-in for the `claude` CLI. Behaviour comes from FAKE_CLAUDE_MODE.
import { appendFileSync } from 'node:fs'

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'
const SID = process.env.FAKE_CLAUDE_SID ?? '0b6f2c1e-4a8d-4e2b-9c3f-7d1a5e8b9f20'
const argv = process.argv.slice(2)
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)

if (argv[0] === 'auth' && argv[1] === 'status') {
  if (mode === 'hang-status') {
    setInterval(() => {}, 1000)
    await new Promise(() => {})
  }
  out({ loggedIn: mode !== 'logged-out', subscriptionType: 'pro' })
  process.exit(0)
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (stdin += d))
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ argv, stdin, pid: process.pid })}\n`)
  }
  const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

  if (mode === 'crash') {
    process.stderr.write('boom')
    process.exit(1)
  }
  out({ type: 'system', subtype: 'init', session_id: SID })
  if (mode === 'limit') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached', session_id: SID })
    process.exit(0)
  }
  if (mode === 'review') {
    const line = (o) => `${JSON.stringify(o)}\n`
    const first = line({ quote: 'Kael melted the lock.', issue: 'Iron repels ember-magic', fix: 'Kael picked the lock.', category: 'continuity' })
    delta('Notes:\n```json\n' + first.slice(0, 30))
    delta(first.slice(30) + line({ quote: 'He ran.', issue: 'Flat', fix: '', category: 'prose' }).trimEnd())
    out({ type: 'result', subtype: 'success', is_error: false, result: 'x', session_id: SID })
    return
  }
  if (mode === 'stale-resume' && argv.some((a) => a.startsWith('--resume'))) {
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'No conversation found with session ID' })
    process.exit(1)
  }
  if (mode === 'flush') {
    out({ type: 'result', subtype: 'success', is_error: false, result: 'x', session_id: SID })
    // Claude Code writes its session file after the result line; a SIGTERM here would lose it.
    setTimeout(() => {
      appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ flushed: true, pid: process.pid })}\n`)
      process.exit(0)
    }, 300)
    return
  }
  if (mode === 'slow') {
    setInterval(() => delta('tick '), 200)
    return
  }
  out({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'world/characters/kael.md' } }] },
  })
  delta('Hello')
  delta(' world')
  out({ type: 'rate_limit_event', rate_limit_info: {} })
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Hello world', session_id: SID })
})
