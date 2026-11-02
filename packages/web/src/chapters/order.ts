/** Moves `activeId` to where `overId` is; returns the same array when nothing changes. */
export function moveId(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId)
  const to = ids.indexOf(overId)
  if (from === -1 || to === -1 || from === to) return ids
  const next = ids.slice()
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
