import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildWing15State, confirmOnWing15, parseStrikes } from '@/lib/wing15'
import { buildDemoState } from '@/lib/wing15-demo'
import type { Wing15State } from '@/types'

// 현재 미확인 뇌전 알림을 TX(송신소) 계정으로 wing15에 현장 확인 처리한다.
// wing15 접속은 이 버튼 클릭 때만 일어난다 (주기 폴링은 익명 피드만 읽음).
// wing15 기록이 성공하면 확인 시각을 TMS 로컬(Setting `wing15ConfirmedAt`)에도 남기고,
// 이후 그 시각까지의 낙뢰는 확인된 것으로 계산된다 (src/lib/wing15.ts).
// wing15 기록이 실패하면 로컬에도 남기지 않고 오류를 돌려줘 다시 누를 수 있게 한다.
// 데모 모드에서는 wing15에 기록하지 않고 데모 확인 완료 상태로만 전환한다.
export async function POST() {
  try {
    let state: Wing15State
    const demo = await prisma.setting.findUnique({ where: { key: 'wing15Demo' } })
    if (demo?.value === 'true') {
      state = buildDemoState(null, true)
      await prisma.setting.upsert({
        where: { key: 'wing15DemoConfirmed' },
        update: { value: 'true' },
        create: { key: 'wing15DemoConfirmed', value: 'true', category: 'wing15' },
      })
    } else {
      const now = Date.now()
      const nowIso = new Date(now).toISOString()
      await confirmOnWing15(now)
      const history = await prisma.setting.findUnique({ where: { key: 'wing15Strikes' } })
      await prisma.setting.upsert({
        where: { key: 'wing15ConfirmedAt' },
        update: { value: nowIso },
        create: { key: 'wing15ConfirmedAt', value: nowIso, category: 'wing15' },
      })
      state = buildWing15State(parseStrikes(history?.value), now, null, now)
    }

    // 확인 후 상태/체크리스트를 즉시 반영 (워커의 다음 폴링 전에도 일관되게)
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: 'wing15State' },
        update: { value: JSON.stringify(state) },
        create: { key: 'wing15State', value: JSON.stringify(state), category: 'wing15' },
      }),
      prisma.setting.upsert({
        where: { key: 'wing15Checklist' },
        update: { value: JSON.stringify(state.checklist) },
        create: {
          key: 'wing15Checklist',
          value: JSON.stringify(state.checklist),
          category: 'wing15',
        },
      }),
    ])

    return NextResponse.json(state)
  } catch (error) {
    console.error('Wing15 confirm error:', error)
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json(
      { error: message ? `현장 확인 처리 실패: ${message}` : '현장 확인 처리 실패' },
      { status: 500 }
    )
  }
}
