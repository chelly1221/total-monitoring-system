import { NextResponse } from 'next/server'
import vm from 'vm'
import { prisma } from '@/lib/db'
import { notifySystemDeleted, notifySystemStatusChanged, notifyAlarmResolution, notifySirenSync } from '@/lib/ws-notify'
import type { MetricsConfig, SystemStatus, DisplayItem } from '@/types'
import { evaluateSensorStatus } from '@/lib/threshold-evaluator'
import { syncMetricsFromConfig } from '@/lib/sync-metrics'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * Recalculate system status based on current metric values and thresholds
 * Skips if system is offline (preserve offline detection logic)
 */
async function recalculateSystemStatus(systemId: string, systemName: string): Promise<void> {
  const system = await prisma.system.findUnique({
    where: { id: systemId },
  })

  if (!system || system.status === 'offline') {
    return
  }

  const metrics = await prisma.metric.findMany({
    where: { systemId },
  })

  // Check if system has condition-based config
  let metricsConfig: MetricsConfig | null = null
  if (system.config) {
    try {
      const parsed = JSON.parse(system.config)
      if ((parsed.delimiter || parsed.customCode) && parsed.displayItems) {
        metricsConfig = parsed as MetricsConfig
      }
    } catch {
      // Invalid JSON
    }
  }

  const hasConditions = metricsConfig?.displayItems?.some((item: DisplayItem) => item.conditions)

  let worstStatus: SystemStatus = 'normal'

  if (hasConditions && metricsConfig) {
    // Condition-based evaluation
    for (const displayItem of metricsConfig.displayItems) {
      if (!displayItem.conditions) continue
      const metric = metrics.find(m => m.name === displayItem.name)
      if (!metric) continue
      const itemStatus: SystemStatus = evaluateSensorStatus(metric.value, displayItem.conditions)
      if (itemStatus === 'critical') {
        worstStatus = 'critical'
        break
      } else if (itemStatus === 'warning') {
        worstStatus = 'warning'
      }
    }
  } else {
    // Legacy threshold evaluation
    for (const metric of metrics) {
      const value = metric.value
      const warning = metric.warningThreshold
      const critical = metric.criticalThreshold

      let metricStatus: SystemStatus = 'normal'

      if (critical !== null && value >= critical) {
        metricStatus = 'critical'
      } else if (warning !== null && value <= warning) {
        metricStatus = 'critical'
      }

      if (metricStatus === 'critical') {
        worstStatus = 'critical'
        break
      }
    }
  }

  if (system.status !== worstStatus) {
    await prisma.system.update({
      where: { id: systemId },
      data: { status: worstStatus },
    })

    notifySystemStatusChanged(systemId, systemName, worstStatus)

    // Resolve alarms when status transitions to normal
    if (worstStatus === 'normal') {
      const resolved = await prisma.alarm.updateMany({
        where: { systemId, resolvedAt: null },
        data: { resolvedAt: new Date() },
      })
      if (resolved.count > 0) {
        notifyAlarmResolution(systemId, systemName)
        notifySirenSync()
      }
    }
  }
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const system = await prisma.system.findUnique({
      where: { id },
      include: {
        metrics: true,
        alarms: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    if (!system) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(system)
  } catch (error) {
    console.error('Failed to fetch system:', error)
    return NextResponse.json(
      { error: 'Failed to fetch system' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
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

    const existingSystem = await prisma.system.findUnique({
      where: { id },
    })

    if (!existingSystem) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
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

    const system = await prisma.system.update({
      where: { id },
      data: {
        name,
        type,
        port: parseInt(port, 10),
        protocol,
        config: config ? JSON.stringify(config) : null,
        audioConfig: audioConfig ? JSON.stringify(audioConfig) : null,
        isEnabled: isEnabled !== false,
      },
    })

    // Sync metrics from config and recalculate status for UPS/sensor types
    if (config && config.displayItems && (type === 'ups' || type === 'sensor')) {
      await syncMetricsFromConfig(id, config as MetricsConfig)
      await recalculateSystemStatus(id, name)
    }

    // Re-fetch with relations so client gets complete data
    const updatedSystem = await prisma.system.findUnique({
      where: { id },
      include: {
        metrics: true,
        alarms: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })

    return NextResponse.json(updatedSystem)
  } catch (error) {
    console.error('Failed to update system:', error)
    return NextResponse.json(
      { error: 'Failed to update system' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()

    const existingSystem = await prisma.system.findUnique({
      where: { id },
    })

    if (!existingSystem) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
      )
    }

    // Allow partial updates (e.g., just isEnabled toggle)
    const updateData: Record<string, unknown> = {}

    if (body.isEnabled !== undefined) {
      updateData.isEnabled = body.isEnabled
    }
    if (body.name !== undefined) {
      updateData.name = body.name
    }
    if (body.config !== undefined) {
      updateData.config = body.config ? JSON.stringify(body.config) : null
    }
    if (body.audioConfig !== undefined) {
      updateData.audioConfig = body.audioConfig ? JSON.stringify(body.audioConfig) : null
    }

    const system = await prisma.system.update({
      where: { id },
      data: updateData,
    })

    // Sync metrics from config and recalculate status for UPS/sensor types
    if (body.config && body.config.displayItems) {
      const systemType = existingSystem.type
      if (systemType === 'ups' || systemType === 'sensor') {
        await syncMetricsFromConfig(id, body.config as MetricsConfig)
        const systemName = body.name || existingSystem.name
        await recalculateSystemStatus(id, systemName)
      }
    }

    // Re-fetch with relations so client gets complete data
    const updatedSystem = await prisma.system.findUnique({
      where: { id },
      include: {
        metrics: true,
        alarms: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })

    return NextResponse.json(updatedSystem)
  } catch (error) {
    console.error('Failed to patch system:', error)
    return NextResponse.json(
      { error: 'Failed to patch system' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params

    const existingSystem = await prisma.system.findUnique({
      where: { id },
    })

    if (!existingSystem) {
      return NextResponse.json(
        { error: 'System not found' },
        { status: 404 }
      )
    }

    const systemName = existingSystem.name

    await prisma.system.delete({
      where: { id },
    })

    // Notify all connected clients (fire-and-forget)
    notifySystemDeleted(id, systemName)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete system:', error)
    return NextResponse.json(
      { error: 'Failed to delete system' },
      { status: 500 }
    )
  }
}
