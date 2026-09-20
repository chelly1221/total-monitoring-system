import { NextResponse } from 'next/server'
import { isIP } from 'node:net'
import { prisma } from '@/lib/db'
import { ClientCommandError, discoverClients, pickServerAddressFor, sendClientCommand } from '@/lib/client-discovery'
import { PI_DISCOVERY_PORT, piChannel } from '@/lib/pi-sensor'
import { registerPiChannel } from '@/lib/pi-registration'
import { notifySystemsChanged } from '@/lib/ws-notify'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const channel = piChannel(body?.channel)
  if (!body || typeof body.ip !== 'string' || isIP(body.ip) !== 4 ||
      typeof body.id !== 'string' || !body.id || !channel ||
      typeof body.name !== 'string' || !body.name.trim() || body.name.length > 64 ||
      (body.closedLevel !== undefined && body.closedLevel !== 0 && body.closedLevel !== 1)) {
    return NextResponse.json({ error: '장비, 채널, 시설명을 확인하세요' }, { status: 400 })
  }
  try {
    const serverIp = pickServerAddressFor(body.ip)
    if (!serverIp) return NextResponse.json({ error: '서버 LAN 주소를 찾을 수 없습니다' }, { status: 503 })
    const found = await discoverClients({ ports: [PI_DISCOVERY_PORT], targets: [{ address: serverIp, broadcast: body.ip, netmask: '255.255.255.255' }] })
    const device = found.find(d => d.kind === 'pi' && d.id === body.id && d.ip === body.ip)
    if (!device || !device.channels?.some(c => c.id === channel.id)) {
      return NextResponse.json({ error: '장비 또는 활성 채널을 다시 탐지하지 못했습니다. 전원과 네트워크를 확인하세요' }, { status: 409 })
    }
    const system = await registerPiChannel(prisma, device, channel.id, body.name.trim())
    notifySystemsChanged()
    try {
      const ack = await sendClientCommand(body.ip, 'config', {
        id: device.id, channel: channel.id, target: { ip: serverIp, port: system.port },
        intervalMs: 5000, closedLevel: body.closedLevel ?? device.channels.find(c => c.id === channel.id)?.closedLevel ?? 0,
      }, { port: PI_DISCOVERY_PORT })
      if (ack.id !== device.id) throw new Error('응답한 장비 식별자가 다릅니다')
    } catch (error) {
      // Keep the same facility/port for a later retry, including lost ACKs.
      return NextResponse.json({ systemId: system.id, provisioned: false,
        error: `시설은 저장했지만 설정 전송에 실패했습니다. 다시 연결하세요: ${error instanceof Error ? error.message : String(error)}` }, { status: error instanceof ClientCommandError && error.kind === 'timeout' ? 504 : 409 })
    }
    return NextResponse.json({ systemId: system.id, provisioned: true })
  } catch (error) {
    console.error('[pi] registration failed', error)
    return NextResponse.json({ error: '라즈베리파이 등록에 실패했습니다' }, { status: 500 })
  }
}
