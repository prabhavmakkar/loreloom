import { expect, test } from 'vitest'
import { contentVersion, parseDoc, stringifyDoc } from '../src/index.ts'

test('frontmatter round-trip', () => {
  const t = stringifyDoc({ id: 'kael', aliases: ['the Oathbreaker'] }, 'Body *text*\n')
  expect(parseDoc(t)).toEqual({ data: { id: 'kael', aliases: ['the Oathbreaker'] }, body: 'Body *text*\n' })
  expect(parseDoc('no frontmatter')).toEqual({ data: {}, body: 'no frontmatter' })
})
test('a body containing --- survives', () => {
  const body = 'a\n---\nb\n'
  expect(parseDoc(stringifyDoc({ id: 'x' }, body)).body).toBe(body)
})
test('contentVersion is 12 hex chars and content-dependent', () => {
  expect(contentVersion('a')).toMatch(/^[0-9a-f]{12}$/)
  expect(contentVersion('a')).not.toBe(contentVersion('b'))
  expect(contentVersion('a')).toBe(contentVersion('a'))
})
test('empty frontmatter block parses to empty data', () => {
  expect(parseDoc('---\n---\nbody')).toEqual({ data: {}, body: 'body' })
})
test('long strings are not line-wrapped', () => {
  const summary = 'word '.repeat(60).trim()
  const text = stringifyDoc({ summary }, '')
  expect(text).toContain(`summary: ${summary}\n`)
})
