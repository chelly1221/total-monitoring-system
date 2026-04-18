import { NextResponse } from 'next/server'
import vm from 'vm'
import { prisma } from '@/lib/db'
import { syncMetricsFromConfig } from '@/lib/sync-metrics'
import type { MetricsConfig } from '@/types'

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

    const { name, type, port, protocol, config, isEnabled, audioConfig } = body

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

    // Validate customCode syntax if present
    if (config?.customCode?.trim()) {
      try {
        const wrapped = `(function(raw) { ${config.customCode} })(rawInput)`
        new vm.Script(wrapped)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json(
          { error: `커스텀 코드 구문 오류: ${msg}` },
          { status: 400 }
        )
      }
    }

    const system = await prisma.system.create({
      data: {
        name,
        type,
        port: parseInt(port, 10),
        protocol,
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

    return NextResponse.json(system, { status: 201 })
  } catch (error) {
    console.error('Failed to create system:', error)
    return NextResponse.json(
      { error: 'Failed to create system' },
      { status: 500 }
    )
  }
}
