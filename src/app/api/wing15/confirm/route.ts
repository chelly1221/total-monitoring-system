import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildWing15State, confirmOnWing15, mergeStrikes, parseConfirmedAt, parseStrikes, Wing15ConfirmationPendingError } from '@/lib/wing15'
import { isStrikeConfirmed, sameStrike } from '@/lib/lightning-rules'
import { buildDemoState } from '@/lib/wing15-demo'
import { readWing15State } from '@/lib/wing15-state'
import { notifyWing15Changed } from '@/lib/ws-notify'

// Only this button writes WING TX inspections. All reviewed strikes must exist
// in WING and its writes must persist before local confirmation. Late arrivals
// are left unconfirmed even when they predate the reviewed time watermark.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const snapshot = await prisma.$transaction(async tx => {
      const current = await readWing15State(tx)
      const rows = await tx.setting.findMany({ where: { key: { in: ['wing15Strikes', 'wing15ConfirmedAt', 'wing15Demo'] } } })
      const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
      const confirmedAt = parseConfirmedAt(values.wing15ConfirmedAt)
      const reviewed = mergeStrikes(parseStrikes(values.wing15Strikes), []).filter(strike => !isStrikeConfirmed(strike, confirmedAt))
      return { current, reviewed, demo: values.wing15Demo === 'true' }
    })
    const { current, reviewed, demo } = snapshot
    if (!current.ok || !current.sig || body?.sig !== current.sig || current.items.some(item => item.active) ||
      !current.checklist.special || !current.checklist.maintenance) {
      return NextResponse.json({ error: '경보 종료 후 최신 점검 항목을 모두 확인하세요' }, { status: 409 })
    }
    if (!demo) await confirmOnWing15(reviewed)

    const state = await prisma.$transaction(async tx => {
      const latest = await readWing15State(tx)
      let state
      if (demo) {
        await tx.setting.upsert({ where: { key: 'wing15DemoConfirmed' }, update: { value: 'true' },
          create: { key: 'wing15DemoConfirmed', value: 'true', category: 'wing15' } })
        state = buildDemoState(null, true)
      } else {
        const rows = await tx.setting.findMany({ where: { key: { in: ['wing15Strikes', 'wing15ConfirmedAt'] } } })
        const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
        const previousConfirmedAt = parseConfirmedAt(values.wing15ConfirmedAt)
        const through = Math.max(previousConfirmedAt ?? -Infinity, ...reviewed.map(strike => strike.detectedAt))
        const strikes = mergeStrikes(parseStrikes(values.wing15Strikes), []).map(strike => ({
          ...strike,
          confirmed: isStrikeConfirmed(strike, previousConfirmedAt) || reviewed.some(item => sameStrike(item, strike)),
        }))
        for (const [key, value] of [['wing15Strikes', JSON.stringify(strikes)], ['wing15ConfirmedAt', new Date(through).toISOString()]]) {
          await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value, category: 'wing15' } })
        }
        state = { ...latest, ...buildWing15State(strikes, through, null), ok: latest.ok,
          updatedAt: latest.updatedAt, error: latest.error, observedAt: latest.observedAt }
      }
      for (const [key, value] of [['wing15State', JSON.stringify(state)], ['wing15Checklist', JSON.stringify(state.checklist)]]) {
        await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value, category: 'wing15' } })
      }
      return state
    })
    notifyWing15Changed(state)
    return NextResponse.json(state)
  } catch (error) {
    if (error instanceof Wing15ConfirmationPendingError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('Wing15 confirm error:', error)
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json({ error: message ? '현장 확인 처리 실패: ' + message : '현장 확인 처리 실패' }, { status: 500 })
  }
}
