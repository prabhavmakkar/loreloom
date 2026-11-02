#!/usr/bin/env node
// Stand-in for the `claude` CLI. Behaviour comes from FAKE_CLAUDE_MODE.
import { appendFileSync } from 'node:fs'

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'
const argv = process.argv.slice(2)
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)

if (argv[0] === 'auth' && argv[1] === 'status') {
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
  out({ type: 'system', subtype: 'init', session_id: 's1' })
  if (mode === 'limit') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached', session_id: 's1' })
    process.exit(0)
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
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Hello world', session_id: 's1' })
})
