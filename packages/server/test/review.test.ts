import { describe, expect, it } from 'vitest'
import { createReviewParser } from '../src/ai/review.ts'

const a = JSON.stringify({ quote: 'He ran.', issue: 'Flat verb', fix: 'He sprinted.', category: 'prose' })
const b = JSON.stringify({ quote: 'Iron melted.', issue: 'Iron repels ember-magic', fix: 'The bars held.', category: 'continuity' })

describe('createReviewParser', () => {
  it('yields complete lines across pushes and skips junk', () => {
    const p = createReviewParser()
    const text = `${a}\nHere are my notes:\n${JSON.stringify({ quote: 'x', issue: 'y', fix: 'z', category: 'vibes' })}\n${b}\n`
    const out = [...p.push(text.slice(0, 20)), ...p.push(text.slice(20, 150)), ...p.push(text.slice(150)), ...p.end()]
    expect(out.map((s) => s.id)).toEqual(['r1', 'r2'])
    expect(out.map((s) => s.category)).toEqual(['prose', 'continuity'])
  })

  it('flushes a final line without newline on end()', () => {
    const p = createReviewParser()
    expect(p.push(a)).toEqual([])
    expect(p.end()).toHaveLength(1)
  })

  it('ignores code fences and allows an empty fix', () => {
    const p = createReviewParser()
    const cut = JSON.stringify({ quote: 'Very very', issue: 'Filler', fix: '', category: 'prose' })
    const out = [...p.push('```json\n' + cut + '\n```\n'), ...p.end()]
    expect(out).toEqual([{ id: 'r1', quote: 'Very very', issue: 'Filler', fix: '', category: 'prose' }])
  })

  it('rejects empty quote, over-long quote and non-string fields', () => {
    const p = createReviewParser()
    const bad = [
      { quote: '', issue: 'i', fix: 'f', category: 'prose' },
      { quote: 'q'.repeat(301), issue: 'i', fix: 'f', category: 'prose' },
      { quote: 'q', issue: 3, fix: 'f', category: 'prose' },
      { quote: 'q', issue: 'i', category: 'prose' },
    ]
    expect([...p.push(bad.map((o) => JSON.stringify(o)).join('\n') + '\n'), ...p.end()]).toEqual([])
  })
})
