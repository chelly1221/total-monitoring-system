import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const sirens = await prisma.siren.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(sirens)
  } catch (error) {
    console.error('Siren list error:', error)
    return NextResponse.json(
      { error: '사이렌 목록 조회 실패' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ip, port, protocol, messageOn, messageOff, location } = body

    if (!ip || !port || !messageOn || !location) {
      return NextResponse.json(
        { error: '필수 항목을 모두 입력해주세요' },
        { status: 400 }
      )
    }

    const portNum = parseInt(port)
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return NextResponse.json(
        { error: '포트 번호는 1-65535 범위여야 합니다' },
        { status: 400 }
      )
    }

    const siren = await prisma.siren.create({
      data: {
        ip,
        port: portNum,
        protocol: protocol || 'tcp',
        messageOn,
        messageOff: messageOff || '',
        location,
      },
    })

    return NextResponse.json(siren)
  } catch (error) {
    console.error('Siren create error:', error)
    return NextResponse.json(
      { error: '사이렌 장비 등록 실패' },
      { status: 500 }
    )
  }
}
