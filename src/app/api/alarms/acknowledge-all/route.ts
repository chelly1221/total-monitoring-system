import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifyAllAlarmsAcknowledged, notifySirenSync } from '@/lib/ws-notify'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const acknowledgedBy = body.acknowledgedBy || 'operator'

    // Get alarm IDs before updating to broadcast them
    const alarmsToAcknowledge = await prisma.alarm.findMany({
      where: {
        acknowledged: false,
        resolvedAt: null,
      },
      select: { id: true },
    })

    const alarmIds = alarmsToAcknowledge.map((a) => a.id)

    const result = await prisma.alarm.updateMany({
      where: {
        acknowledged: false,
        resolvedAt: null,
      },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy,
      },
    })

    // Broadcast bulk acknowledgment via WebSocket
    if (alarmIds.length > 0) {
      notifyAllAlarmsAcknowledged(alarmIds)
    }
    notifySirenSync()

    return NextResponse.json({ count: result.count })
  } catch (error) {
    console.error('Failed to acknowledge all alarms:', error)
    return NextResponse.json(
      { error: 'Failed to acknowledge all alarms' },
      { status: 500 }
    )
  }
}
