import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') ?? 'sensor'
    const metricName = searchParams.get('metricName')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const hours = parseInt(searchParams.get('hours') ?? '24', 10)

    // Use from/to if provided, otherwise fall back to hours
    const since = from ? new Date(from) : new Date(Date.now() - hours * 60 * 60 * 1000)
    const until = to ? new Date(to) : undefined

    const recordedAtFilter: { gte: Date; lte?: Date } = { gte: since }
    if (until) recordedAtFilter.lte = until

    const metricWhere: { system: { type: string }; name?: string } = { system: { type } }
    if (metricName) metricWhere.name = metricName

    const metrics = await prisma.metric.findMany({
      where: metricWhere,
      select: {
        id: true,
        name: true,
        unit: true,
        systemId: true,
        system: { select: { name: true } },
        history: {
          where: { recordedAt: recordedAtFilter },
          orderBy: { recordedAt: 'asc' },
          select: { value: true, recordedAt: true },
        },
      },
    })

    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Failed to fetch metric history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch metric history' },
      { status: 500 }
    )
  }
}
