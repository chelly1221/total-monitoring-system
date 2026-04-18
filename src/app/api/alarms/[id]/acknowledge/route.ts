import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifyAlarmAcknowledged, notifySirenSync } from '@/lib/ws-notify'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const acknowledgedBy = body.acknowledgedBy || 'operator'

    const alarm = await prisma.alarm.update({
      where: { id },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy,
      },
      include: {
        system: {
          select: { id: true, name: true },
        },
      },
    })

    // Broadcast alarm acknowledgment via WebSocket
    notifyAlarmAcknowledged(id, alarm.systemId, alarm.system.name)
    notifySirenSync()

    return NextResponse.json(alarm)
  } catch (error) {
    console.error('Failed to acknowledge alarm:', error)
    return NextResponse.json(
      { error: 'Failed to acknowledge alarm' },
      { status: 500 }
    )
  }
}
