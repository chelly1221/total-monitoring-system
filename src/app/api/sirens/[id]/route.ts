import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(
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
    return NextResponse.json(siren)
  } catch (error) {
    console.error('Siren fetch error:', error)
    return NextResponse.json(
      { error: '사이렌 장비 조회 실패' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { ip, port, protocol, messageOn, messageOff, location, isEnabled } = body

    const portNum = port !== undefined ? parseInt(port) : undefined
    if (portNum !== undefined && (isNaN(portNum) || portNum < 1 || portNum > 65535)) {
      return NextResponse.json(
        { error: '포트 번호는 1-65535 범위여야 합니다' },
        { status: 400 }
      )
    }

    const siren = await prisma.siren.update({
      where: { id },
      data: {
        ...(ip !== undefined && { ip }),
        ...(portNum !== undefined && { port: portNum }),
        ...(protocol !== undefined && { protocol }),
        ...(messageOn !== undefined && { messageOn }),
        ...(messageOff !== undefined && { messageOff }),
        ...(location !== undefined && { location }),
        ...(isEnabled !== undefined && { isEnabled }),
      },
    })

    return NextResponse.json(siren)
  } catch (error) {
    console.error('Siren update error:', error)
    return NextResponse.json(
      { error: '사이렌 장비 수정 실패' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await prisma.siren.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Siren delete error:', error)
    return NextResponse.json(
      { error: '사이렌 장비 삭제 실패' },
      { status: 500 }
    )
  }
}
