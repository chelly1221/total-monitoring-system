import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { Wing15Checklist } from '@/types'
import { readWing15State } from '@/lib/wing15-state'
import { notifyWing15Changed } from '@/lib/ws-notify'

// 뇌전경보 체크리스트(특별점검/유지보수일지) 상태 저장.
// sig는 현재 미확인 알림 구성의 서명 — 알림이 바뀌면 체크가 무효화된다.
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<Wing15Checklist>
    if (
      !body || typeof body.special !== 'boolean' ||
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
    const state = await prisma.$transaction(async (tx) => {
      const current = await readWing15State(tx)
      if (!current.ok || current.sig !== checklist.sig || !current.sig || current.items.some(item => item.active)) return null
      await tx.setting.upsert({
        where: { key: 'wing15Checklist' },
        update: { value },
        create: { key: 'wing15Checklist', value, category: 'wing15' },
      })
      return { ...current, checklist }
    })
    if (!state) return NextResponse.json({ error: '경보 상태가 변경되었습니다. 최신 상태를 확인하세요' }, { status: 409 })
    notifyWing15Changed(state)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Wing15 checklist error:', error)
    return NextResponse.json({ error: '체크리스트 저장 실패' }, { status: 500 })
  }
}
