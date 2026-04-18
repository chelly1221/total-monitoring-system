import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const systemId = searchParams.get('systemId')

    const where = systemId ? { systemId } : {}

    const metrics = await prisma.metric.findMany({
      where,
      include: { system: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(metrics)
  } catch (error) {
    console.error('Failed to fetch metrics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    )
  }
}
