import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelAi, streamAi } from '../api.ts'
import type { AiErrorCode, AiRunBody, ReviewSuggestion } from '../api.ts'

export type RunState = 'idle' | 'running' | 'error'
export interface RunError {
  code: AiErrorCode
  message: string
}
export interface RunResult {
  text: string
  ok: boolean
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/**
 * Runs the helper and exposes the streamed reply. Each `run` resets the output. `cancel`
 * (and unmounting) aborts the fetch and tells the server, which stops the process.
 */
export function useAiRun() {
  const [state, setState] = useState<RunState>('idle')
  const [text, setText] = useState('')
  const [activity, setActivity] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<ReviewSuggestion[]>([])
  const [error, setError] = useState<RunError | undefined>()
  const live = useRef<{ ac: AbortController; requestId?: string } | null>(null)

  const stop = useCallback(() => {
    const cur = live.current
    if (!cur) return
    live.current = null
    cur.ac.abort()
    if (cur.requestId) void cancelAi(cur.requestId).catch(() => {})
  }, [])

  const run = useCallback(
    async (body: AiRunBody): Promise<RunResult> => {
      stop()
      const me = { ac: new AbortController() } as { ac: AbortController; requestId?: string }
      live.current = me
      const mine = () => live.current === me
      let acc = ''
      let failed: RunError | undefined
      setState('running')
      setText('')
      setActivity([])
      setSuggestions([])
      setError(undefined)
      try {
        await streamAi(
          body,
          (ev) => {
            if (!mine()) return
            if (ev.type === 'start') me.requestId = ev.requestId
            else if (ev.type === 'text') {
              acc += ev.text
              setText(acc)
            } else if (ev.type === 'suggestion') setSuggestions((l) => [...l, ev.suggestion])
            else if (ev.type === 'activity') setActivity((a) => [...a, ev.text])
            else if (ev.type === 'error' && ev.code !== 'cancelled') failed = { code: ev.code, message: ev.message }
          },
          me.ac.signal,
        )
      } catch (e) {
        if (!isAbort(e) && mine()) failed = { code: 'failed', message: 'The helper could not be reached.' }
      }
      if (!mine()) return { text: acc, ok: false } // cancelled or superseded: stop() already reset state
      live.current = null
      if (failed) {
        setError(failed)
        setState('error')
      } else setState('idle')
      return { text: acc, ok: !failed }
    },
    [stop],
  )

  const cancel = useCallback(() => {
    stop()
    setState('idle')
  }, [stop])

  /** Stops any run and clears the output, e.g. when the chapter it was written for changes. */
  const reset = useCallback(() => {
    stop()
    setState('idle')
    setText('')
    setActivity([])
    setSuggestions([])
    setError(undefined)
  }, [stop])

  useEffect(() => stop, [stop])

  return { run, cancel, reset, state, text, activity, suggestions, error }
}
