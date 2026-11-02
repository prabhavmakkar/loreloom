import { expect, test } from 'vitest'
import { extractMentions } from '../src/index.ts'

test('unique mentions in first-seen order', () => {
  expect(extractMentions('[Kael](@character/kael) and [Kael](@character/kael) at [the Gate](@place/ember-gate)')).toEqual([
    { kind: 'character', id: 'kael' },
    { kind: 'place', id: 'ember-gate' },
  ])
})

test('ignores unknown kinds and ordinary links', () => {
  expect(extractMentions('[x](@weapon/sword) [y](https://a.b)')).toEqual([])
})
