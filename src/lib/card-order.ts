export function readCardOrder(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []
  } catch { return [] }
}

export function orderCards<T extends { id: string }>(items: T[], saved: string[]): T[] {
  const remaining = new Map(items.map(item => [item.id, item]))
  const ordered: T[] = []
  for (const id of saved) {
    const item = remaining.get(id)
    if (item) { ordered.push(item); remaining.delete(id) }
  }
  return [...ordered, ...remaining.values()]
}

export function moveCard(ids: string[], from: string, to: string): string[] {
  const start = ids.indexOf(from)
  const end = ids.indexOf(to)
  if (start < 0 || end < 0 || start === end) return ids
  const next = [...ids]
  next.splice(start, 1)
  next.splice(end, 0, from)
  return next
}

export interface CardSlot { id: string; left: number; top: number; width: number; height: number }

export function nearestCardSlot(slots: CardSlot[], x: number, y: number): string | undefined {
  // Distance to the rectangle handles mixed card heights and gaps between grid cells.
  let nearest: string | undefined
  let distance = Infinity
  for (const slot of slots) {
    const dx = Math.max(slot.left - x, 0, x - slot.left - slot.width)
    const dy = Math.max(slot.top - y, 0, y - slot.top - slot.height)
    const next = dx * dx + dy * dy
    if (next < distance) { distance = next; nearest = slot.id }
  }
  return nearest
}
