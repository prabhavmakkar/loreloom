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
    expect(findQuote('one two three', 'two')).toEqual({ from: 4, to: 7, count: 1 })
  })
  it('counts every match, so a repeated passage is never applied to the wrong one', () => {
    expect(findQuote('He ran. She stayed. He ran.', 'He ran.')?.count).toBe(2)
    expect(findQuote('He said “hi”. Later he said "hi".', 'said "hi"')?.count).toBe(2)
  })
  it('matches a quote with markdown emphasis, escapes or mention links against the plain text', () => {
    const text = 'Kael looked at the Ember Gate and froze.'
    const r = findQuote(text, 'Kael *looked* at the [Ember Gate](@place/ember-gate) and _froze_\\.')!
    expect(text.slice(r.from, r.to)).toBe('Kael looked at the Ember Gate and froze.')
    expect(r.count).toBe(1)
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
