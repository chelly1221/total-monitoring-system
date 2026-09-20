import type { ClientUnitRegistration, DiscoveredClient, SoundClientInfo } from '@/types'
import { upsClientUnit } from '@/lib/ups-client-preset'

interface SystemRow { id: string; name: string; config: string | null }

/**
 * Mark discovered clients with the facilities that already use them. Sound and
 * ping clients bind to one facility; a UPS client PC feeds up to two facilities
 * (UPS#1 and UPS#2), so its registrations are reported per card and the other
 * card stays selectable.
 */
export function markRegistrations<T extends Omit<DiscoveredClient, 'registered' | 'registeredUnits'>>(
  replies: T[], systems: SystemRow[],
): (T & Pick<DiscoveredClient, 'registered' | 'registeredUnits' | 'registeredChannels'>)[] {
  const registered = new Map<string, { systemId: string; systemName: string }>()
  const units = new Map<string, ClientUnitRegistration[]>()
  const channels = new Map<string, NonNullable<DiscoveredClient['registeredChannels']>>()
  for (const system of systems) {
    if (!system.config) continue
    let client: SoundClientInfo | undefined
    try {
      client = (JSON.parse(system.config) as { client?: SoundClientInfo }).client
    } catch {
      continue // Legacy or non-JSON config; ignore.
    }
    if (!client?.id) continue
    const entry = { systemId: system.id, systemName: system.name }
    if (client.kind === 'pi' && client.channel) {
      const list = channels.get(client.id) ?? []
      list.push({ channel: client.channel, ...entry })
      channels.set(client.id, list)
    } else if (client.kind === 'ups') {
      const list = units.get(client.id) ?? []
      list.push({ unit: upsClientUnit(client.unit), ...entry })
      units.set(client.id, list)
    } else {
      registered.set(client.id, entry)
    }
  }
  return replies.map(reply => reply.kind === 'pi'
    ? { ...reply, registered: null, registeredChannels: channels.get(reply.id) ?? [] }
    : reply.kind === 'ups'
    ? { ...reply, registered: null, registeredUnits: (units.get(reply.id) ?? []).sort((a, b) => a.unit - b.unit) }
    : { ...reply, registered: registered.get(reply.id) ?? null })
}
