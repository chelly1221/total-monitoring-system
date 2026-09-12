import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { discoverClients, suggestSoundClientPort } from '@/lib/client-discovery'
import { UDP_PORTS } from '@/worker/config'
import type { DiscoveredClient, EquipmentConfig } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * Scan the LAN for TMS SoundSense clients (one on-demand broadcast probe per
 * interface) and mark the ones already bound to a facility.
 */
export async function GET() {
  try {
    const [replies, systems] = await Promise.all([
      discoverClients(),
      prisma.system.findMany({
        where: { isActive: true },
        select: { id: true, name: true, port: true, protocol: true, config: true },
      }),
    ])

    const registeredByClientId = new Map<string, { systemId: string; systemName: string }>()
    const usedPorts = new Set<number>(Object.keys(UDP_PORTS).map(Number))
    for (const system of systems) {
      if (system.port != null && system.protocol !== 'mqtt') usedPorts.add(system.port)
      if (!system.config) continue
      try {
        const parsed = JSON.parse(system.config) as Partial<EquipmentConfig>
        if (parsed.client?.id) registeredByClientId.set(parsed.client.id, { systemId: system.id, systemName: system.name })
      } catch {
        // Legacy or non-JSON config; ignore.
      }
    }

    const clients: DiscoveredClient[] = replies
      .map(reply => ({ ...reply, registered: registeredByClientId.get(reply.id) ?? null }))
      .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host, 'ko'))

    return NextResponse.json({ clients, suggestedPort: suggestSoundClientPort(usedPorts) })
  } catch (error) {
    console.error('Client discovery failed:', error)
    return NextResponse.json({ error: 'PC 탐지에 실패했습니다' }, { status: 500 })
  }
}
