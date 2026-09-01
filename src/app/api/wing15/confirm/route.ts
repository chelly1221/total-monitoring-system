import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { confirmAsTx } from '@/lib/wing15'
import { buildDemoState } from '@/lib/wing15-demo'
import type { Wing15State } from '@/types'

// 현재 미확인 뇌전 알림 전부를 TX(송신소) 계정으로 wing15에 현장 확인 처리한다.
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
      state = await confirmAsTx()
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
    return NextResponse.json({ error: '현장 확인 처리 실패' }, { status: 500 })
  }
}
