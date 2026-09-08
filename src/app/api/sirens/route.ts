import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateSirenBody } from '@/lib/siren-validation'
import { parsePort } from '@/lib/system-validation'
import { Prisma } from '@prisma/client'

export async function GET() {
  try {
    const sirens = await prisma.siren.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(sirens)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return NextResponse.json({ error: '이미 등록된 IP와 포트입니다' }, { status: 409 })
      if (error.code === 'P2025') return NextResponse.json({ error: '사이렌 장비를 찾을 수 없습니다' }, { status: 404 })
    }
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
    const validationError = validateSirenBody(body, false)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
    const { ip, port, protocol, messageOn, messageOff, location } = body

    const portNum = parsePort(port)!

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
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return NextResponse.json({ error: '이미 등록된 IP와 포트입니다' }, { status: 409 })
      if (error.code === 'P2025') return NextResponse.json({ error: '사이렌 장비를 찾을 수 없습니다' }, { status: 404 })
    }
    console.error('Siren create error:', error)
    return NextResponse.json(
      { error: '사이렌 장비 등록 실패' },
      { status: 500 }
    )
  }
}
