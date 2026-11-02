import cytoscape from 'cytoscape'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../api.ts'
import type { Card } from '../api.ts'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import { toElements } from './graph.ts'

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Reads the theme tokens at call time, so a theme switch just needs a restyle. */
function buildStyle(): cytoscape.StylesheetJson {
  const ink = css('--ink')
  const ink2 = css('--ink-2')
  const edge = css('--ink-3')
  const paper = css('--paper')
  const accent = css('--accent')
  const font = css('--font-ui')
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-family': font,
        'font-size': 12,
        color: ink,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'background-color': css('--paper-3'),
        'border-width': 2,
        'border-color': ink2,
        width: 34,
        height: 34,
      },
    },
    { selector: 'node[role = "protagonist"]', style: { 'background-color': accent, 'border-color': accent } },
    { selector: 'node.pending', style: { 'border-color': accent, 'border-width': 4 } },
    { selector: 'node:selected', style: { 'border-color': accent, 'border-width': 4 } },
    {
      selector: 'edge',
      style: {
        label: 'data(label)',
        'font-family': font,
        'font-size': 10,
        color: ink2,
        width: 1.5,
        'line-color': edge,
        'target-arrow-color': edge,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'text-background-color': paper,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'text-rotation': 'autorotate',
      },
    },
    { selector: 'edge:selected', style: { 'line-color': accent, 'target-arrow-color': accent, width: 2.5 } },
  ] as cytoscape.StylesheetJson
}

const LAYOUT = { name: 'cose', animate: false, idealEdgeLength: () => 220, nodeRepulsion: () => 400000, nodeOverlap: 60, edgeElasticity: () => 60 } as const

export function CharacterMap({ characters, onOpen, onChanged }: { characters: Card[]; onOpen(id: string): void; onChanged(): Promise<void> }) {
  const host = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [connect, setConnect] = useState(false)
  const [from, setFrom] = useState<string | null>(null)
  const [pair, setPair] = useState<{ from: string; to: string } | null>(null)
  const [kind, setKind] = useState('')
  const [removing, setRemoving] = useState<{ from: string; to: string; kind: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tap handlers are bound once, so they read the latest state through this ref.
  const live = useRef({ connect, from, onOpen })
  live.current = { connect, from, onOpen }
  const charactersRef = useRef(characters)
  charactersRef.current = characters

  // Mount once: create the instance, wire events, restyle on theme change, destroy on unmount.
  useEffect(() => {
    if (!host.current) return
    const cy = cytoscape({
      container: host.current,
      elements: toElements(charactersRef.current),
      style: buildStyle(),
      layout: { ...LAYOUT, padding: 60 },
      minZoom: 0.3,
      maxZoom: 1.2,
      wheelSensitivity: 0.3,
    })
    cyRef.current = cy
    if (import.meta.env.DEV) (window as unknown as { __cy?: cytoscape.Core }).__cy = cy

    cy.on('tap', 'node', (ev) => {
      const id = ev.target.id() as string
      const { connect: on, from: src, onOpen: open } = live.current
      if (!on) return open(id)
      if (!src) return setFrom(id)
      if (src === id) return setFrom(null)
      setPair({ from: src, to: id })
      setKind('')
      setError(null)
    })
    cy.on('tap', 'edge', (ev) => {
      if (live.current.connect) return
      const d = ev.target.data() as { source: string; target: string; label: string }
      setRemoving({ from: d.source, to: d.target, kind: d.label })
    })

    const resizer = new ResizeObserver(() => cy.resize())
    resizer.observe(host.current)
    const restyle = () => cy.style(buildStyle())
    const observer = new MutationObserver(restyle)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', restyle)
    return () => {
      observer.disconnect()
      resizer.disconnect()
      media.removeEventListener('change', restyle)
      cy.destroy()
      cyRef.current = null
      if (import.meta.env.DEV) delete (window as unknown as { __cy?: cytoscape.Core }).__cy
    }
  }, [])

  // On card changes patch the graph in place; only a new node triggers a layout (from current positions).
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const next = toElements(characters)
    const wanted = new Set(next.map((e) => e.data.id as string))
    let addedNode = false
    cy.batch(() => {
      cy.elements().forEach((el) => {
        if (!wanted.has(el.id())) el.remove()
      })
      // Nodes first, so edges always find their endpoints.
      for (const def of next) {
        const existing = cy.getElementById(def.data.id as string)
        if (existing.nonempty()) existing.data(def.data)
        else if (!def.data.source) {
          cy.add(def)
          addedNode = true
        }
      }
      for (const def of next) {
        if (def.data.source && cy.getElementById(def.data.id as string).empty()) cy.add(def)
      }
    })
    if (addedNode) cy.layout({ ...LAYOUT, padding: 60, randomize: false, fit: true }).run()
  }, [characters])

  // Highlight the chosen source in connect mode.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().removeClass('pending')
    if (connect && from) cy.getElementById(from).addClass('pending')
  }, [connect, from, characters])

  const name = (id: string) => characters.find((c) => c.id === id)?.name ?? id

  const stopConnect = () => {
    setConnect(false)
    setFrom(null)
    setPair(null)
    setError(null)
  }

  const submitConnect = async (e: FormEvent) => {
    e.preventDefault()
    const k = kind.trim()
    if (!pair || !k) return
    try {
      await api.addRelationship(pair.from, { to: pair.to, kind: k })
      await onChanged()
      setPair(null)
      setFrom(null)
      setKind('')
      setError(null)
    } catch {
      setError('Could not save that relationship.')
    }
  }

  const confirmRemove = async () => {
    const r = removing
    if (!r) return
    try {
      await api.removeRelationship(r.from, { to: r.to, kind: r.kind })
      await onChanged()
      setRemoving(null)
    } catch {
      setRemoving(null)
      setError('Could not remove that relationship.')
    }
  }

  return (
    <div className="char-map">
      <div className="map-toolbar">
        <button
          type="button"
          className={connect ? 'primary small' : 'ghost small'}
          aria-pressed={connect}
          onClick={() => (connect ? stopConnect() : setConnect(true))}
        >
          {connect ? 'Done connecting' : 'Connect characters'}
        </button>
        <span className="muted map-hint">
          {!connect && 'Click a character to open it, or an arrow to remove it. Drag to rearrange.'}
          {connect && !from && 'Click the character the relationship starts from.'}
          {connect && from && !pair && `From ${name(from)}: now click who it points to.`}
        </span>
      </div>
      <div className="map-canvas" ref={host} aria-label="Character map" role="img" />
      {characters.length === 0 && <p className="muted map-empty">No characters yet. Add some from Characters in the sidebar.</p>}
      {pair && (
        <form className="map-popover" onSubmit={(e) => void submitConnect(e)}>
          <span>
            {name(pair.from)} → {name(pair.to)}
          </span>
          <input aria-label="Relationship" autoFocus placeholder="e.g. fears" value={kind} onChange={(e) => setKind(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setPair(null)} />
          <button type="submit" className="primary small" disabled={!kind.trim()}>
            Connect
          </button>
          <button type="button" className="ghost small" onClick={() => setPair(null)}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p className="form-error map-error" role="alert">
          {error}
        </p>
      )}
      {removing && (
        <ConfirmDialog
          title="Remove relationship?"
          message={`${name(removing.from)} ${removing.kind} ${name(removing.to)}. The characters stay; only this link goes.`}
          confirmLabel="Remove"
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
