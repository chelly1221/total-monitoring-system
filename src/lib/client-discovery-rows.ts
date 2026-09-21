import type { DiscoveredClient } from '../types'

export interface ClientDiscoveryRow {
  key: string
  client: DiscoveredClient
  unit?: 1 | 2
  registration: DiscoveredClient['registered']
}

/** List selectable UPS cards separately and keep unregistered entries first. */
export function clientDiscoveryRows(clients: DiscoveredClient[]): ClientDiscoveryRow[] {
  const rows = clients.flatMap((client): ClientDiscoveryRow[] => {
    if (client.kind !== 'ups') {
      return [{ key: client.id, client, registration: client.registered }]
    }
    const reported = [...new Set((client.units ?? []).map(item => item.unit))]
      .filter((unit): unit is 1 | 2 => unit === 1 || unit === 2)
    const units: (1 | 2)[] = reported.length ? reported : [1, 2]
    return units.map(unit => ({
      key: `${client.id}:${unit}`,
      client,
      unit,
      registration: client.registeredUnits?.find(item => item.unit === unit) ?? null,
    }))
  })
  return rows.sort((a, b) => Number(!!a.registration) - Number(!!b.registration))
}
