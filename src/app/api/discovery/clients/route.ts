import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { discoverClients, suggestSoundClientPort } from '@/lib/client-discovery'
import { UDP_PORTS } from '@/worker/config'
import { markRegistrations } from '@/lib/client-registrations'
import type { DiscoveredClient } from '@/types'

export const dynamic = 'force-dynamic'

/**
 * Scan the LAN for TMS clients (one on-demand broadcast probe per interface)
 * and mark the ones already bound to a facility (per UPS card for UPS clients).
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

    const usedPorts = new Set<number>(Object.keys(UDP_PORTS).map(Number))
    for (const system of systems) {
      if (system.port != null && system.protocol !== 'mqtt') usedPorts.add(system.port)
    }

    const clients: DiscoveredClient[] = markRegistrations(replies, systems)
      .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host, 'ko'))

    return NextResponse.json({ clients, suggestedPort: suggestSoundClientPort(usedPorts) })
  } catch (error) {
    console.error('Client discovery failed:', error)
    return NextResponse.json({ error: 'PC 탐지에 실패했습니다' }, { status: 500 })
  }
}
