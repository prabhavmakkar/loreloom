import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { clearAiSession } from '../api.ts'
import type { AiRunBody } from '../api.ts'
import type { EditorHandle } from '../editor/handle.ts'
import { ActivityLines, RichText, RunNotice } from './parts.tsx'
import { useAiRun } from './stream.ts'

interface Message {
  role: 'author' | 'helper'
  text: string
}

// Kept for the page session only, per book: closing the panel keeps the conversation, reloading clears it.
const transcripts = new Map<string, Message[]>()

export function BrainstormTab({ bookKey, chapterId, editor }: { bookKey: string; chapterId: string | null; editor: RefObject<EditorHandle | null> }) {
  const [messages, setMessages] = useState<Message[]>(() => transcripts.get(bookKey) ?? [])
  const [input, setInput] = useState('')
  const { run, cancel, state, text, activity, error } = useAiRun()
  const lastBody = useRef<AiRunBody | null>(null)
  const generation = useRef(0) // bumped by New conversation so a late reply cannot restore the old transcript
  const running = state === 'running'

  const remember = (next: Message[]) => {
    transcripts.set(bookKey, next)
    setMessages(next)
  }

  // Switching chapters mid-reply would leave the answer about the wrong chapter.
  useEffect(() => cancel, [chapterId, cancel])

  const send = async (message: string, base: Message[], extra: Partial<AiRunBody> = {}) => {
    const selection = editor.current?.getSelectionText() ?? ''
    const gen = generation.current
    const body: AiRunBody = {
      mode: 'brainstorm',
      message,
      ...(chapterId ? { chapterId } : {}),
      ...(selection ? { selection } : {}),
      ...extra,
    }
    lastBody.current = body
    const result = await run(body)
    if (gen === generation.current && result.text.trim()) remember([...base, { role: 'helper', text: result.text }])
  }

  const submit = () => {
    const message = input.trim()
    if (!message || running) return
    const base: Message[] = [...messages, { role: 'author', text: message }]
    remember(base)
    setInput('')
    void send(message, base)
  }

  const retry = () => {
    if (!lastBody.current) return
    const message = lastBody.current.message
    void send(message, messages)
  }

  const newConversation = () => {
    generation.current++
    cancel()
    transcripts.delete(bookKey)
    setMessages([])
    void clearAiSession('brainstorm').catch(() => {})
  }

  return (
    <div className="helper-tab">
      <div className="transcript" aria-live="polite">
        {messages.length === 0 && !running && (
          <p className="muted hint">Stuck? Ask what a character wants, what the world would do next, or how to get out of a corner.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'helper' ? <RichText text={m.text} /> : <p>{m.text}</p>}
          </div>
        ))}
        {running && (
          <div className="msg helper">
            {text ? <RichText text={text} /> : <p className="muted">Thinking…</p>}
            <ActivityLines lines={activity} />
          </div>
        )}
        {error && <RunNotice error={error} onRetry={retry} />}
      </div>
      <form
        className="helper-compose"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          aria-label="Ask the helper"
          rows={3}
          value={input}
          placeholder="Ask anything about your story…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="helper-actions">
          {running ? (
            <button type="button" className="small" onClick={cancel}>
              Stop
            </button>
          ) : (
            <button type="submit" className="small primary" disabled={!input.trim()}>
              Send
            </button>
          )}
          <button type="button" className="small ghost" onClick={newConversation} disabled={messages.length === 0 && !running}>
            New conversation
          </button>
        </div>
      </form>
    </div>
  )
}
