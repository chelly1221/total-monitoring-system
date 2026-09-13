import { NextResponse } from 'next/server'
import { isIP } from 'net'
import { CLIENT_DISCOVERY_PORTS, ClientCommandError, sendClientCommand } from '@/lib/client-discovery'

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
    const discoveryPort = body.discoveryPort ?? 7790
    if (!CLIENT_DISCOVERY_PORTS.includes(discoveryPort)) {
      return NextResponse.json({ error: '지원하지 않는 클라이언트 탐지 포트입니다' }, { status: 400 })
    }

    const ack = await sendClientCommand(ip, 'identify', { sec }, { port: discoveryPort })
    return NextResponse.json({ ok: true, id: ack.id })
  } catch (error) {
    if (error instanceof ClientCommandError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === 'timeout' ? 504 : 409 })
    }
    console.error('Client identify failed:', error)
    return NextResponse.json({ error: 'PC 확인 요청에 실패했습니다' }, { status: 500 })
  }
}
