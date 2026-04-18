import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendTcp, sendUdp } from '@/lib/siren'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const siren = await prisma.siren.findUnique({ where: { id } })

    if (!siren) {
      return NextResponse.json(
        { error: '사이렌 장비를 찾을 수 없습니다' },
        { status: 404 }
      )
    }

    const send = siren.protocol === 'udp' ? sendUdp : sendTcp
    await send(siren.ip, siren.port, siren.messageOn)

    if (siren.messageOff) {
      const ip = siren.ip, port = siren.port, msg = siren.messageOff, proto = siren.protocol
      setTimeout(async () => {
        try {
          const sendOff = proto === 'udp' ? sendUdp : sendTcp
          await sendOff(ip, port, msg)
        } catch (e) {
          console.error('Siren stop error:', e)
        }
      }, 2000)
    }

    return NextResponse.json({
      success: true,
      message: `${siren.location} 사이렌 테스트 전송 완료 (2초 후 정지)`,
    })
  } catch (error) {
    console.error('Siren test error:', error)
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json(
      { success: false, error: `사이렌 테스트 실패: ${message}` },
      { status: 500 }
    )
  }
}
