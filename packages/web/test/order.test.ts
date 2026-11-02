import { describe, expect, it } from 'vitest'
import { moveId } from '../src/chapters/order.ts'

describe('moveId', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('moves forward and backward', () => {
    expect(moveId(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveId(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('returns the same array for no-ops and unknown ids', () => {
    expect(moveId(ids, 'b', 'b')).toBe(ids)
    expect(moveId(ids, 'x', 'b')).toBe(ids)
    expect(moveId(ids, 'b', 'x')).toBe(ids)
  })
  it('does not mutate its input', () => {
    moveId(ids, 'a', 'd')
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})
