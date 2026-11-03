export type AiMode = 'brainstorm' | 'draft' | 'review'
export type AiErrorCode = 'not_installed' | 'not_logged_in' | 'rate_limited' | 'cancelled' | 'failed'
export type AiStatus = { available: boolean; reason?: 'not_installed' | 'not_logged_in' | 'unresponsive'; subscriptionType?: string }
export type ReviewCategory = 'prose' | 'pacing' | 'continuity' | 'dialogue'
export interface ReviewSuggestion {
  id: string
  quote: string
  issue: string
  fix: string
  category: ReviewCategory
}
export type AiEvent =
  | { type: 'start'; requestId: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'activity'; text: string }
  | { type: 'suggestion'; suggestion: ReviewSuggestion }
  | { type: 'done'; sessionId?: string }
  | { type: 'error'; code: AiErrorCode; message: string }
export interface AiRunInput {
  mode: AiMode
  systemPrompt: string
  prompt: string
  cwd: string
  resumeSessionId?: string
}
export interface AiProvider {
  status(): Promise<AiStatus>
  run(input: AiRunInput, signal: AbortSignal): AsyncIterable<AiEvent>
}
