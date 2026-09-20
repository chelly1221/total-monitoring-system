import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { readChartHistory } from '@/lib/metric-history'

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
    const until = to ? new Date(to) : new Date()
    if ((!from && (!Number.isFinite(hours) || hours <= 0)) || !Number.isFinite(since.getTime()) ||
      (until && (!Number.isFinite(until.getTime()) || until < since))) {
      return NextResponse.json({ error: '조회 기간을 확인하세요' }, { status: 400 })
    }

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
      },
    })

    // Release the connection between metrics so saves can interleave with a
    // long-range chart query. Never materialize every raw reading in Node/WebView.
    const result = []
    for (const metric of metrics) {
      if (request.signal.aborted) return new Response(null, { status: 499 })
      result.push({ ...metric, history: await readChartHistory(prisma, metric.id, since.getTime(), until.getTime()) })
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch (error) {
    console.error('Failed to fetch metric history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch metric history' },
      { status: 500 }
    )
  }
}
