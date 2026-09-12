import { NextResponse } from 'next/server'
import { isIP } from 'net'
import { prisma } from '@/lib/db'
import { ClientCommandError, sendClientCommand } from '@/lib/client-discovery'

export const dynamic = 'force-dynamic'

/** Ask one SoundSense client to make itself visible (flash + banner + beep). */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const ip = body && typeof body.ip === 'string' ? body.ip.trim() : ''
    if (isIP(ip) !== 4) {
      return NextResponse.json({ error: '유효한 IP 주소가 아닙니다' }, { status: 400 })
    }
    const sec = Number.isInteger(body.sec) && body.sec >= 1 && body.sec <= 60 ? body.sec : 5

    const tokenSetting = await prisma.setting.findUnique({ where: { key: 'clientToken' } })
    const ack = await sendClientCommand(ip, 'identify', { sec }, { token: tokenSetting?.value ?? '' })
    return NextResponse.json({ ok: true, id: ack.id })
  } catch (error) {
    if (error instanceof ClientCommandError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === 'timeout' ? 504 : 409 })
    }
    console.error('Client identify failed:', error)
    return NextResponse.json({ error: 'PC 확인 요청에 실패했습니다' }, { status: 500 })
  }
}
