import { describe, expect, it } from 'vitest'
import type { Card, CardKind } from '../src/api.ts'
import { filterCards } from '../src/editor/mentions.tsx'

const card = (kind: CardKind, id: string, name: string, aliases: string[] = []): Card => ({
  kind, id, name, aliases, summary: '', body: '', relationships: [], fields: {}, version: 'v',
})

const cards: Record<CardKind, Card[]> = {
  term: [card('term', 'mirror-oath', 'Mirror Oath')],
  place: [card('place', 'ember-gate', 'Ember Gate')],
  rule: [],
  character: [card('character', 'mira', 'Mira Vale', ['the Nail-Wright', 'Mira']), card('character', 'queen', 'The Ember Queen', ['Queen'])],
}

describe('filterCards', () => {
  it('matches name or alias by word prefix, characters first, with the shortest matching label', () => {
    expect(filterCards(cards, 'Mi')).toEqual([
      { kind: 'character', id: 'mira', label: 'Mira', name: 'Mira Vale' },
      { kind: 'term', id: 'mirror-oath', label: 'Mirror Oath', name: 'Mirror Oath' },
    ])
  })

  it('matches aliases and later words', () => {
    expect(filterCards(cards, 'nail').map((i) => i.id)).toEqual(['mira'])
    expect(filterCards(cards, 'ember').map((i) => i.id)).toEqual(['queen', 'ember-gate'])
  })

  it('lists every card for an empty query', () => {
    expect(filterCards(cards, '').map((i) => i.id)).toEqual(['mira', 'queen', 'ember-gate', 'mirror-oath'])
  })
})
