import { describe, expect, it } from 'vitest'
import { findQuote } from '../src/helper/findQuote.ts'

describe('findQuote', () => {
  it('matches ignoring quote style, dashes and whitespace runs', () => {
    expect(findQuote('He said "hi" — then  left.', 'said “hi” - then left')).not.toBeNull()
  })
  it('returns null when absent', () => {
    expect(findQuote('abc', 'xyz')).toBeNull()
  })
  it('returns exact offsets', () => {
    expect(findQuote('one two three', 'two')).toEqual({ from: 4, to: 7 })
  })
  it('maps fuzzy matches back to original offsets', () => {
    const text = 'He said "hi" —  then  left.'
    const r = findQuote(text, 'said “hi” - then left')!
    expect(text.slice(r.from, r.to)).toBe('said "hi" —  then  left')
  })
  it('returns null for an empty quote', () => {
    expect(findQuote('abc', '  ')).toBeNull()
  })
})
