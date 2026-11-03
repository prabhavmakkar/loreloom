import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { createInterface } from 'node:readline'
import type { AiEvent, AiProvider, AiRunInput, AiStatus } from './provider.ts'
import { isSessionId } from './sessions.ts'

export interface ClaudeCodeOptions {
  command?: string
  /** Arguments placed before the real ones (tests point `command` at node and this at a fake script). */
  commandArgs?: string[]
  /** How long `claude auth status` may take before it counts as unresponsive. */
  statusTimeoutMs?: number
}

const STATUS_TTL_MS = 60_000
const STATUS_TIMEOUT_MS = 15_000
const KILL_AFTER_MS = 3_000
/** After the result line, Claude Code still writes its session file; give it this long to exit by itself. */
const FLUSH_GRACE_MS = 5_000
const STDERR_TAIL = 500
const RATE_LIMIT_RE = /usage limit|rate limit|limit reached/i
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

export class ClaudeCodeProvider implements AiProvider {
  private readonly command: string
  private readonly commandArgs: string[]
  private readonly statusTimeoutMs: number
  private cached: { at: number; status: AiStatus } | null = null

  constructor(opts: ClaudeCodeOptions = {}) {
    this.command = opts.command ?? 'claude'
    this.commandArgs = opts.commandArgs ?? []
    this.statusTimeoutMs = opts.statusTimeoutMs ?? STATUS_TIMEOUT_MS
  }

  async status(): Promise<AiStatus> {
    if (this.cached && Date.now() - this.cached.at < STATUS_TTL_MS) return this.cached.status
    const status = await this.readStatus()
    // Only a positive answer is cached: after `/login` or an install, the next check must see it.
    this.cached = status.available ? { at: Date.now(), status } : null
    return status
  }

  private readStatus(): Promise<AiStatus> {
    return new Promise((resolve) => {
      let out = ''
      let settled = false
      const finish = (s: AiStatus) => {
        if (settled) return
        settled = true
        resolve(s)
      }
      const child = spawn(this.command, [...this.commandArgs, 'auth', 'status', '--json'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish({ available: false, reason: 'unresponsive' })
      }, this.statusTimeoutMs)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (d: string) => (out += d))
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        finish({ available: false, reason: err.code === 'ENOENT' ? 'not_installed' : 'not_logged_in' })
      })
      child.on('close', () => {
        clearTimeout(timer)
        // Only `loggedIn` and `subscriptionType` are ever read from the output.
        let parsed: unknown
        try {
          parsed = JSON.parse(out)
        } catch {
          return finish({ available: false, reason: 'not_logged_in' })
        }
        if (!isObj(parsed) || parsed.loggedIn !== true) return finish({ available: false, reason: 'not_logged_in' })
        finish(
          typeof parsed.subscriptionType === 'string'
            ? { available: true, subscriptionType: parsed.subscriptionType }
            : { available: true },
        )
      })
    })
  }

  async *run(input: AiRunInput, signal: AbortSignal): AsyncGenerator<AiEvent> {
    if (signal.aborted) {
      yield { type: 'error', code: 'cancelled', message: 'Cancelled.' }
      return
    }
    const args = [
      ...this.commandArgs,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      ...(input.mode === 'review' ? ['--no-session-persistence'] : []),
      '--tools',
      ...READ_ONLY_TOOLS,
      '--allowedTools',
      ...READ_ONLY_TOOLS,
      '--append-system-prompt',
      input.systemPrompt,
      ...(isSessionId(input.resumeSessionId) ? [`--resume=${input.resumeSessionId}`] : []),
    ]
    const child = spawn(this.command, args, { cwd: input.cwd, stdio: ['pipe', 'pipe', 'pipe'] })

    let spawnError: NodeJS.ErrnoException | null = null
    let stderr = ''
    let exited = false
    let killTimer: NodeJS.Timeout | undefined
    const exitCode = new Promise<number | null>((resolve) => {
      child.once('error', (err: NodeJS.ErrnoException) => {
        spawnError = err
        exited = true
        resolve(null)
      })
      child.once('close', (code) => {
        exited = true
        resolve(code)
      })
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-STDERR_TAIL)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input.prompt)

    const terminate = () => {
      if (exited) return
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => {
        if (!exited) child.kill('SIGKILL')
      }, KILL_AFTER_MS)
    }
    const onAbort = () => terminate()
    signal.addEventListener('abort', onAbort, { once: true })

    let sessionId: string | undefined
    let finished = false
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    try {
      for await (const line of rl) {
        if (signal.aborted) break
        let msg: unknown
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (!isObj(msg)) continue
        for (const ev of this.translate(msg, input.cwd, (id) => (sessionId = id), () => sessionId)) {
          if (ev.type === 'done' || ev.type === 'error') finished = true
          yield ev
        }
        if (finished) break
      }

      if (signal.aborted) {
        terminate()
        await exitCode
        yield { type: 'error', code: 'cancelled', message: 'Cancelled.' }
        return
      }
      if (finished) return

      const code = await exitCode
      if (spawnError) {
        const missing = (spawnError as NodeJS.ErrnoException).code === 'ENOENT'
        yield {
          type: 'error',
          code: missing ? 'not_installed' : 'failed',
          message: missing ? 'Claude Code is not installed.' : (spawnError as Error).message,
        }
        return
      }
      yield {
        type: 'error',
        code: 'failed',
        message: stderr.trim() || `The helper stopped unexpectedly (exit code ${code ?? 'unknown'}).`,
      }
    } finally {
      // The child must never outlive the iterator (early `break`, abort, or error).
      signal.removeEventListener('abort', onAbort)
      rl.close()
      if (finished && !signal.aborted) {
        // A normal finish: let the CLI flush its session (needed for --resume) before stopping it.
        let grace: NodeJS.Timeout | undefined
        await Promise.race([exitCode, new Promise((r) => (grace = setTimeout(r, FLUSH_GRACE_MS)))])
        clearTimeout(grace)
      }
      terminate()
      await exitCode
      clearTimeout(killTimer)
    }
  }

  private *translate(msg: Obj, cwd: string, setSession: (id: string) => void, getSession: () => string | undefined): Generator<AiEvent> {
    if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
      setSession(msg.session_id)
      yield { type: 'session', sessionId: msg.session_id }
    } else if (msg.type === 'stream_event' && isObj(msg.event) && msg.event.type === 'content_block_delta') {
      const d = msg.event.delta
      if (isObj(d) && d.type === 'text_delta' && typeof d.text === 'string') yield { type: 'text', text: d.text }
    } else if (msg.type === 'assistant' && isObj(msg.message) && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (!isObj(block) || block.type !== 'tool_use') continue
        const target = isObj(block.input) ? (block.input.file_path ?? block.input.pattern ?? block.input.path) : undefined
        yield { type: 'activity', text: `${verbFor(block.name)} ${typeof target === 'string' ? displayPath(target, cwd) : ''}`.trim() }
      }
    } else if (msg.type === 'result') {
      const text = typeof msg.result === 'string' ? msg.result : ''
      if (msg.is_error === true) {
        yield RATE_LIMIT_RE.test(text)
          ? { type: 'error', code: 'rate_limited', message: text || 'Usage limit reached.' }
          : { type: 'error', code: 'failed', message: text.slice(-STDERR_TAIL) || 'The helper reported an error.' }
      } else {
        const id = typeof msg.session_id === 'string' ? msg.session_id : getSession()
        yield id ? { type: 'done', sessionId: id } : { type: 'done' }
      }
    }
  }
}

function verbFor(tool: unknown): string {
  return tool === 'Grep' || tool === 'Glob' ? 'Searching' : 'Reading'
}

/** Shows paths inside the book folder relative to it ("world/characters/kael.md"). */
function displayPath(target: string, cwd: string): string {
  if (!isAbsolute(target)) return target
  let real = cwd
  try {
    real = realpathSync(cwd)
  } catch {
    // keep cwd as given
  }
  for (const root of [cwd, real]) {
    const rel = relative(root, target)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return rel
  }
  return target
}
