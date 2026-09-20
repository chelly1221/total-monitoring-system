import type { EquipmentConfig, MetricsConfig, SoundClientInfo } from '@/types'

// Fixed assignments keep installation, discovery and wiring diagrams in agreement.
export const PI_CHANNELS = [
  { id: 'dht1', kind: 'dht22', label: '온습도 1', gpio: 4, pin: 7 },
  { id: 'dht2', kind: 'dht22', label: '온습도 2', gpio: 17, pin: 11 },
  { id: 'dht3', kind: 'dht22', label: '온습도 3', gpio: 27, pin: 13 },
  { id: 'dht4', kind: 'dht22', label: '온습도 4', gpio: 22, pin: 15 },
  { id: 'door1', kind: 'mc38', label: '개폐 1', gpio: 23, pin: 16 },
  { id: 'door2', kind: 'mc38', label: '개폐 2', gpio: 24, pin: 18 },
  { id: 'door3', kind: 'mc38', label: '개폐 3', gpio: 25, pin: 22 },
  { id: 'door4', kind: 'mc38', label: '개폐 4', gpio: 26, pin: 37 },
] as const

export type PiChannelId = typeof PI_CHANNELS[number]['id']
export interface PiChannelReply { id: PiChannelId; target: { ip: string; port: number } | null; closedLevel?: number }
export const PI_DISCOVERY_PORT = 7793
export const PI_DATA_PORT_RANGE = { from: 6300, to: 6399 }

export function piChannel(value: unknown) {
  return PI_CHANNELS.find(c => c.id === value)
}

export function piBinding(config: Record<string, unknown> | null): SoundClientInfo | null {
  const client = config?.client as SoundClientInfo | undefined
  return client?.kind === 'pi' ? client : null
}

/** Reject late packets from a deleted/reassigned channel before they refresh liveness. */
export function piMeasurement(raw: string, client: SoundClientInfo): string | null {
  try {
    const packet = JSON.parse(raw)
    if (packet?.v !== 1 || packet.t !== 'sensor' || packet.id !== client.id || packet.channel !== client.channel || typeof packet.value !== 'string') return null
    if (piChannel(client.channel)?.kind === 'mc38') return ['OPEN', 'CLOSED'].includes(packet.value) ? packet.value : null
    if (!/^-?\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(packet.value)) return null
    const [temperature, humidity] = packet.value.split(',').map(Number)
    return temperature >= -40 && temperature <= 80 && humidity >= 0 && humidity <= 100 ? packet.value : null
  } catch { return null }
}

export function piPreset(channel: PiChannelId, client: SoundClientInfo): EquipmentConfig | MetricsConfig {
  if (piChannel(channel)?.kind === 'mc38') {
    return { normalPatterns: ['CLOSED'], criticalPatterns: ['OPEN'], matchMode: 'exact', criticalConfirmations: 1, client }
  }
  return {
    delimiter: ',', client,
    displayItems: [
      { name: '온도', index: 0, unit: '°C', itemType: 'temperature', warning: null, critical: null },
      { name: '습도', index: 1, unit: '%', warning: null, critical: null },
    ],
  }
}

export function parsePiChannels(value: unknown): PiChannelReply[] {
  if (!Array.isArray(value) || value.length > PI_CHANNELS.length) return []
  const seen = new Set<string>()
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || !piChannel(entry.id) || seen.has(entry.id)) return []
    seen.add(entry.id)
    const target = entry.target
    return [{ id: entry.id as PiChannelId, closedLevel: entry.closedLevel === 1 ? 1 : 0, target: target && typeof target.ip === 'string' && Number.isInteger(target.port) && target.port > 0 && target.port <= 65535 ? { ip: target.ip, port: target.port } : null }]
  })
}
