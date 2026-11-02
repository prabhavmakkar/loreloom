import { expect, test } from 'vitest'
import { isValidId, slugify, uniqueSlug } from '../src/index.ts'

test('slugify', () => {
  expect(slugify("Mira's Oath!")).toBe('miras-oath')
  expect(slugify('  The Ember   Gate ')).toBe('the-ember-gate')
  expect(slugify('Élan Vítal')).toBe('elan-vital')
  expect(slugify('🔥🔥')).toBe('untitled')
  expect(slugify('../../etc/passwd')).toBe('etc-passwd')
  expect(slugify('a'.repeat(100)).length).toBe(60)
})
test('slugify trims a dash left by truncation', () => {
  expect(slugify('a'.repeat(59) + ' b')).toBe('a'.repeat(59))
})
test('uniqueSlug', () => {
  expect(uniqueSlug('kael', new Set(['kael', 'kael-2']))).toBe('kael-3')
  expect(uniqueSlug('kael', new Set())).toBe('kael')
})
test('isValidId', () => {
  expect(isValidId('kael-2')).toBe(true)
  for (const bad of ['', '../x', 'a/b', 'A', '-x', 'x'.repeat(65)]) expect(isValidId(bad)).toBe(false)
})
