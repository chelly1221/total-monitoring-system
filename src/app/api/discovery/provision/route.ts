import { NextResponse } from 'next/server'
import { isIP } from 'net'
import { prisma } from '@/lib/db'
import {
  ClientCommandError,
  DEFAULT_HEARTBEAT_MS,
  pickServerAddressFor,
  sendClientCommand,
} from '@/lib/client-discovery'
import { parsePort } from '@/lib/system-validation'

export const dynamic = 'force-dynamic'

/**
 * Push the send target (this server's ip + the facility's listening port) and
 * the on/off payloads to one SoundSense client so it needs no manual setup.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 })
    }
    const ip = typeof body.ip === 'string' ? body.ip.trim() : ''
    if (isIP(ip) !== 4) {
      return NextResponse.json({ error: '유효한 IP 주소가 아닙니다' }, { status: 400 })
    }
    const port = parsePort(body.port)
    if (port === null) {
      return NextResponse.json({ error: '포트는 1~65535 사이의 정수여야 합니다' }, { status: 400 })
    }
    const on = typeof body.on === 'string' ? body.on.trim() : ''
    const off = typeof body.off === 'string' ? body.off.trim() : ''
    if (!on || !off || on === off || on.length > 64 || off.length > 64) {
      return NextResponse.json({ error: '정상 패턴과 심각 패턴을 서로 다르게 입력하세요' }, { status: 400 })
    }
    const intervalMs = Number.isInteger(body.intervalMs) && body.intervalMs >= 1000 && body.intervalMs <= 60000
      ? body.intervalMs
      : DEFAULT_HEARTBEAT_MS
    const serverIp = typeof body.serverIp === 'string' && isIP(body.serverIp) === 4
      ? body.serverIp
      : pickServerAddressFor(ip)
    if (!serverIp) {
      return NextResponse.json({ error: '서버의 LAN IP를 찾을 수 없습니다' }, { status: 500 })
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : undefined

    const tokenSetting = await prisma.setting.findUnique({ where: { key: 'clientToken' } })
    const ack = await sendClientCommand(
      ip,
      'config',
      { target: { ip: serverIp, port }, on, off, intervalMs, ...(name ? { name } : {}) },
      { token: tokenSetting?.value ?? '' },
    )
    return NextResponse.json({ ok: true, id: ack.id, target: { ip: serverIp, port } })
  } catch (error) {
    if (error instanceof ClientCommandError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === 'timeout' ? 504 : 409 })
    }
    console.error('Client provisioning failed:', error)
    return NextResponse.json({ error: 'PC 설정 전송에 실패했습니다' }, { status: 500 })
  }
}
