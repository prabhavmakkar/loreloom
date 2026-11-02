import { describe, expect, it } from 'vitest'
import type { Card } from '../src/api.ts'
import { toElements } from '../src/world/graph.ts'

const ch = (id: string, name: string, relationships: Card['relationships'] = [], fields: Card['fields'] = {}): Card => ({
  kind: 'character', id, name, aliases: [], summary: '', body: '', relationships, fields, version: 'v',
})

const sample = [
  ch('kael', 'Kael Thorne', [{ to: 'aldric', kind: 'swore oath to' }, { to: 'mira', kind: 'travels with' }], { role: 'protagonist' }),
  ch('mira', 'Mira', [{ to: 'kael', kind: 'trusts' }]),
  ch('queen', 'The Queen', [{ to: 'kael', kind: 'hunts' }]),
  ch('aldric', 'Aldric'),
]

describe('toElements', () => {
  it('makes one node per character with label and role', () => {
    const nodes = toElements(sample).filter((e) => !e.data.source)
    expect(nodes).toHaveLength(4)
    expect(nodes[0]!.data).toEqual({ id: 'kael', label: 'Kael Thorne', role: 'protagonist' })
    expect(nodes[1]!.data.role).toBe('')
  })
  it('makes one edge per relationship', () => {
    const edges = toElements(sample).filter((e) => e.data.source)
    expect(edges).toHaveLength(4)
    expect(edges[0]!.data).toEqual({ id: 'kael->aldric:swore oath to', source: 'kael', target: 'aldric', label: 'swore oath to' })
  })
  it('skips edges whose target does not exist', () => {
    const els = toElements([ch('a', 'A', [{ to: 'ghost', kind: 'fears' }, { to: 'b', kind: 'knows' }]), ch('b', 'B')])
    expect(els.filter((e) => e.data.source).map((e) => e.data.id)).toEqual(['a->b:knows'])
  })
  it('gives every element a unique id', () => {
    const ids = toElements(sample).map((e) => e.data.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('collapses duplicate relationships to one edge', () => {
    const els = toElements([ch('a', 'A', [{ to: 'b', kind: 'knows' }, { to: 'b', kind: 'knows' }]), ch('b', 'B')])
    expect(els.filter((e) => e.data.source)).toHaveLength(1)
  })
})
