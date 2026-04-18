import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const acknowledged = searchParams.get('acknowledged')
    const severity = searchParams.get('severity')
    const systemId = searchParams.get('systemId')
    const limit = parseInt(searchParams.get('limit') || '50')

    const where: Record<string, unknown> = {}

    if (acknowledged !== null) {
      where.acknowledged = acknowledged === 'true'
    }

    const resolved = searchParams.get('resolved')
    if (resolved !== null) {
      where.resolvedAt = resolved === 'true' ? { not: null } : null
    }

    if (severity) {
      where.severity = severity
    }

    if (systemId) {
      where.systemId = systemId
    }

    const alarms = await prisma.alarm.findMany({
      where,
      include: { system: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json(alarms)
  } catch (error) {
    console.error('Failed to fetch alarms:', error)
    return NextResponse.json(
      { error: 'Failed to fetch alarms' },
      { status: 500 }
    )
  }
}
