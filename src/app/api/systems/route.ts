import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { syncMetricsFromConfig } from '@/lib/sync-metrics'
import { validateSystemBody, parsePort, normalizeEncoding, normalizeOfflineThreshold } from '@/lib/system-validation'
import { notifySystemsChanged } from '@/lib/ws-notify'
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
    const validationError = validateSystemBody(body, request.method === 'PATCH')
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

    const { name, type, port, protocol, topic, config, isEnabled, audioConfig, offlineThreshold, encoding } = body

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
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
    if (!['udp', 'tcp', 'mqtt'].includes(protocol)) {
      return NextResponse.json(
        { error: 'Invalid protocol. Must be udp, tcp, or mqtt' },
        { status: 400 }
      )
    }

    // MQTT is addressed by topic (kept unique); UDP/TCP by port. Ports MAY be
    // shared by multiple systems — devices all send TO us, and the ingest path
    // fans each datagram out to every system on the port, attributing data by
    // each system's own parse config.
    const isMqtt = protocol === 'mqtt'
    let portNum: number | null = null
    let topicStr: string | null = null

    if (isMqtt) {
      topicStr = typeof topic === 'string' ? topic.trim() : ''
      if (!topicStr) {
        return NextResponse.json({ error: 'MQTT 토픽을 입력하세요' }, { status: 400 })
      }
      // Routing is by exact topic, so wildcard subscriptions would silently never match.
      if (topicStr.includes('+') || topicStr.includes('#')) {
        return NextResponse.json({ error: 'MQTT 토픽에 와일드카드(+, #)는 사용할 수 없습니다' }, { status: 400 })
      }
      const dup = await prisma.system.findFirst({
        where: { protocol: 'mqtt', topic: topicStr, isActive: true },
        select: { name: true },
      })
      if (dup) {
        return NextResponse.json(
          { error: `토픽 충돌: MQTT 토픽 "${topicStr}"은 이미 "${dup.name}"에서 사용 중입니다` },
          { status: 409 }
        )
      }
    } else {
      if (!port) {
        return NextResponse.json({ error: 'Port and protocol are required' }, { status: 400 })
      }
      portNum = parsePort(port)
    }

    const system = await prisma.$transaction(async (tx) => {
      const created = await tx.system.create({
        data: {
          name,
          type,
          port: portNum,
          protocol,
          topic: topicStr,
          offlineThreshold: normalizeOfflineThreshold(offlineThreshold),
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
        await syncMetricsFromConfig(created.id, config as MetricsConfig, tx)
      }

      return created
    })

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
