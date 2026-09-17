// Facility-PC client kinds and their fixed discovery ports. No Node imports: shared by
// API routes, browser components, validation and tests (client-discovery.ts re-exports it).

export type ClientKind = 'sound' | 'ping' | 'ups'

export const CLIENT_KIND_PORTS: Record<ClientKind, number> = {
  sound: 7790,
  ping: 7791,
  ups: 7792,
}

export const CLIENT_KIND_NAMES: Record<ClientKind, string> = {
  sound: '음성탐지기',
  ping: '네트워크 ping 감시',
  ups: '2026 1레이더 UPS',
}

export function clientKindOf(value: unknown): ClientKind {
  return value === 'ping' || value === 'ups' ? value : 'sound'
}

export function clientKindName(kind: unknown): string {
  return CLIENT_KIND_NAMES[clientKindOf(kind)]
}

export function discoveryPortFor(kind: unknown): number {
  return CLIENT_KIND_PORTS[clientKindOf(kind)]
}

/** UPS clients answer with one entry per UPS card; the label used in facility names. */
export function upsUnitLabel(unit: number | undefined): string {
  return unit === 2 ? 'UPS#2' : 'UPS#1'
}
