import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { piDashboard } from '@/lib/pi-dashboard'
import { readWing15State } from '@/lib/wing15-state'
import { notifySystemsChanged } from '@/lib/ws-notify'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id || id.length > 128) return NextResponse.json({ error: '장비 식별자가 필요합니다' }, { status: 400 })
  const [systems, alarms, enabled] = await Promise.all([
    prisma.system.findMany({ where: { isActive: true } }),
    prisma.alarm.findMany({ where: { resolvedAt: null, system: { isActive: true, isEnabled: true } },
      include: { system: true }, orderBy: { lastSeenAt: 'desc' } }),
    prisma.setting.findUnique({ where: { key: 'wing15Enabled' } }),
  ])
  const result = piDashboard(systems, alarms, id, enabled?.value === 'false' ? undefined : await readWing15State())
  return result ? NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ error: '서버에서 채널을 먼저 등록하세요' }, { status: 404 })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.id !== 'string' || body.id.length > 128 || typeof body.channel !== 'string' ||
      typeof body.name !== 'string' || !body.name.trim() || [...body.name.trim()].length > 20 || /[\u0000-\u001f]/.test(body.name)) {
    return NextResponse.json({ error: '장비와 센서 이름을 확인하세요' }, { status: 400 })
  }
  const systems = await prisma.system.findMany({ where: { isActive: true } })
  const system = systems.find(system => {
    try { const client = JSON.parse(system.config || '{}').client
      return client?.kind === 'pi' && client.id === body.id && client.channel === body.channel
    } catch { return false }
  })
  if (!system) return NextResponse.json({ error: '등록된 채널이 없습니다' }, { status: 404 })
  await prisma.system.update({ where: { id: system.id }, data: { name: body.name.trim() } })
  notifySystemsChanged()
  return NextResponse.json({ ok: true })
}
