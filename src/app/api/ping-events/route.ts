import { NextRequest, NextResponse } from 'next/server'
import {
  attachFailureSummaryToAlarm,
  currentFailureSummary,
  listPingEvents,
  parsePingEventReport,
  storePingEvents,
} from '@/lib/ping-events'
import { notifyAlarmValue, notifyPingEvents } from '@/lib/ws-notify'

export const dynamic = 'force-dynamic'

/** Failure / recovery events posted by a 네트워크 ping 감시 client. */
export async function POST(request: Request) {
  try {
    const report = parsePingEventReport(await request.json().catch(() => null))
    if (!report) {
      return NextResponse.json({ error: 'invalid report' }, { status: 400 })
    }
    const result = await storePingEvents(report)
    if (result.system && result.inserted > 0) {
      notifyPingEvents(result.system.id, report.clientId)
      const summary = await currentFailureSummary(result.system.id)
      if (summary) {
        const alarmId = await attachFailureSummaryToAlarm(result.system.id, summary)
        if (alarmId) notifyAlarmValue(result.system.id, result.system.name, alarmId, summary)
      }
    }
    return NextResponse.json({ ok: true, stored: result.inserted, systemId: result.system?.id ?? null })
  } catch (error) {
    console.error('Ping event report failed:', error)
    return NextResponse.json({ error: 'failed to store events' }, { status: 500 })
  }
}

/** Recent events for one facility (system detail page). */
export async function GET(request: NextRequest) {
  const systemId = request.nextUrl.searchParams.get('systemId')?.trim() ?? ''
  if (!systemId) {
    return NextResponse.json({ error: 'systemId가 필요합니다' }, { status: 400 })
  }
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 100
  try {
    return NextResponse.json({ events: await listPingEvents(systemId, limit) })
  } catch (error) {
    console.error('Ping event query failed:', error)
    return NextResponse.json({ error: 'ping 장애 내역을 불러오지 못했습니다' }, { status: 500 })
  }
}
