import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { syncMetricsFromConfig } from '@/lib/sync-metrics'
import { validateCustomCode } from '@/lib/validate-custom-code'
import { notifySystemsChanged } from '@/lib/ws-notify'
import type { MetricsConfig } from '@/types'

// Normalize the wire-encoding field: only 'utf8' | 'buffer' are valid, else null (default).
function normalizeEncoding(e: unknown): string | null {
  return e === 'utf8' || e === 'buffer' ? e : null
}

export async function GET() {
  try {
    const systems = await prisma.system.findMany({
      where: { isActive: true },
      include: { metrics: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(systems)
  } catch (error) {
    console.error('Failed to fetch systems:', error)
    return NextResponse.json(
      { error: 'Failed to fetch systems' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { name, type, port, protocol, config, isEnabled, audioConfig, offlineThreshold, encoding } = body

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      )
    }

    if (!port || !protocol) {
      return NextResponse.json(
        { error: 'Port and protocol are required' },
        { status: 400 }
      )
    }

    // Validate type
    if (!['equipment', 'ups', 'sensor'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid system type. Must be equipment, ups, or sensor' },
        { status: 400 }
      )
    }

    // Validate protocol
    if (!['udp', 'tcp'].includes(protocol)) {
      return NextResponse.json(
        { error: 'Invalid protocol. Must be udp or tcp' },
        { status: 400 }
      )
    }

    // Reject duplicate (port, protocol): routing is by port only, so a second
    // system on the same socket cannot be disambiguated and silently shadows data.
    const portNum = parseInt(port, 10)
    const dup = await prisma.system.findFirst({
      where: { port: portNum, protocol, isActive: true },
      select: { name: true },
    })
    if (dup) {
      return NextResponse.json(
        { error: `포트 충돌: ${protocol.toUpperCase()} ${portNum} 포트는 이미 "${dup.name}"에서 사용 중입니다` },
        { status: 409 }
      )
    }

    if (config?.customCode?.trim()) {
      const result = validateCustomCode(config.customCode)
      if (!result.valid) {
        return NextResponse.json(
          { error: `커스텀 코드 구문 오류: ${result.error}` },
          { status: 400 }
        )
      }
    }

    const system = await prisma.system.create({
      data: {
        name,
        type,
        port: portNum,
        protocol,
        offlineThreshold: offlineThreshold != null ? parseInt(offlineThreshold, 10) : null,
        encoding: normalizeEncoding(encoding),
        config: config ? JSON.stringify(config) : null,
        audioConfig: audioConfig ? JSON.stringify(audioConfig) : null,
        isEnabled: isEnabled !== false,
        status: 'offline',
        isActive: true,
      },
    })

    // Sync metrics from config for UPS/sensor types
    if (config && config.displayItems && (type === 'ups' || type === 'sensor')) {
      await syncMetricsFromConfig(system.id, config as MetricsConfig)
    }

    // Tell the worker to bind a socket for this new (port, protocol).
    notifySystemsChanged()

    return NextResponse.json(system, { status: 201 })
  } catch (error) {
    console.error('Failed to create system:', error)
    return NextResponse.json(
      { error: 'Failed to create system' },
      { status: 500 }
    )
  }
}
