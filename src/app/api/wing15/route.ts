import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { Wing15Checklist, Wing15State } from '@/types'

// 워커 폴러가 Setting에 저장한 최신 뇌전 감시 상태를 반환한다.
export async function GET() {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ['wing15State', 'wing15Checklist'] } },
    })
    const map = rows.reduce<Record<string, string>>((acc, r) => {
      acc[r.key] = r.value
      return acc
    }, {})

    let state: Wing15State = {
      ok: false,
      error: '수집 대기 중',
      updatedAt: '',
      sig: '',
      items: [],
      checklist: { special: false, maintenance: false, sig: '' },
    }
    if (map.wing15State) {
      try {
        state = JSON.parse(map.wing15State) as Wing15State
      } catch {
        // 손상된 상태값은 기본값으로 대체
      }
    }
    // 체크리스트는 별도 키가 최신 (체크 직후 워커 브로드캐스트 전 조회 대비)
    if (map.wing15Checklist) {
      try {
        const checklist = JSON.parse(map.wing15Checklist) as Wing15Checklist
        if (checklist.sig === state.sig) state.checklist = checklist
      } catch {
        // 무시
      }
    }
    return NextResponse.json(state)
  } catch (error) {
    console.error('Wing15 status error:', error)
    return NextResponse.json({ error: '뇌전 감시 상태 조회 실패' }, { status: 500 })
  }
}
