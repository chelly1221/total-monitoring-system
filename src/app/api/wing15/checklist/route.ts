import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { Wing15Checklist } from '@/types'

// 뇌전경보 체크리스트(특별점검/유지보수일지) 상태 저장.
// sig는 현재 미확인 알림 구성의 서명 — 알림이 바뀌면 체크가 무효화된다.
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<Wing15Checklist>
    if (
      typeof body.special !== 'boolean' ||
      typeof body.maintenance !== 'boolean' ||
      typeof body.sig !== 'string'
    ) {
      return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
    }
    const checklist: Wing15Checklist = {
      special: body.special,
      maintenance: body.maintenance,
      sig: body.sig,
    }
    const value = JSON.stringify(checklist)
    await prisma.setting.upsert({
      where: { key: 'wing15Checklist' },
      update: { value },
      create: { key: 'wing15Checklist', value, category: 'wing15' },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Wing15 checklist error:', error)
    return NextResponse.json({ error: '체크리스트 저장 실패' }, { status: 500 })
  }
}
