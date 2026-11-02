import type cytoscape from 'cytoscape'
import type { Card } from '../api.ts'

/** Turns character cards into Cytoscape elements: a node per character, an edge per relationship. */
export function toElements(characters: Card[]): cytoscape.ElementDefinition[] {
  const ids = new Set(characters.map((c) => c.id))
  const nodes: cytoscape.ElementDefinition[] = characters.map((c) => ({
    data: { id: c.id, label: c.name, role: typeof c.fields.role === 'string' ? c.fields.role : '' },
  }))
  const edges: cytoscape.ElementDefinition[] = []
  const seen = new Set<string>()
  for (const c of characters) {
    for (const r of c.relationships) {
      if (!ids.has(r.to)) continue
      const id = `${c.id}->${r.to}:${r.kind}`
      if (seen.has(id)) continue
      seen.add(id)
      edges.push({ data: { id, source: c.id, target: r.to, label: r.kind } })
    }
  }
  return [...nodes, ...edges]
}
