import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { buildWing15State, parseConfirmedAt, parseStrikes } from './wing15'
import { buildDemoState } from './wing15-demo'
import type { Wing15Checklist, Wing15State } from '@/types'
import { AMO_MAX_DATA_AGE_MS } from './amo-lightning'

export async function readWing15State(db: Prisma.TransactionClient = prisma): Promise<Wing15State> {
  const rows = await db.setting.findMany({ where: { key: { in: [
    'wing15State', 'wing15Strikes', 'wing15Checklist', 'wing15ConfirmedAt', 'wing15Demo', 'wing15DemoConfirmed',
  ] } } })
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
  let checklist: Wing15Checklist | null = null
  try {
    const parsed = JSON.parse(values.wing15Checklist ?? 'null')
    if (parsed && typeof parsed.special === 'boolean' && typeof parsed.maintenance === 'boolean' && typeof parsed.sig === 'string') checklist = parsed
  } catch { /* Invalid checklist resets below. */ }
  if (values.wing15Demo === 'true') return buildDemoState(checklist, values.wing15DemoConfirmed === 'true')
  const state = buildWing15State(parseStrikes(values.wing15Strikes), parseConfirmedAt(values.wing15ConfirmedAt), checklist)
  // Derive alert age and confirmation from current local data, preserving the
  // last poll's connectivity indicator instead of freezing active alerts forever.
  try {
    const saved = JSON.parse(values.wing15State ?? 'null')
    if (saved && typeof saved.ok === 'boolean' && typeof saved.updatedAt === 'string') {
      const observedAt = typeof saved.observedAt === 'string' ? saved.observedAt : undefined
      const age = Date.now() - Date.parse(observedAt ?? saved.updatedAt)
      const stale = !Number.isFinite(age) || age > AMO_MAX_DATA_AGE_MS || age < -5 * 60_000
      return { ...state, ok: saved.ok && !stale,
        error: stale ? '항공기상청 낙뢰 자료 갱신 지연' : typeof saved.error === 'string' ? saved.error : undefined,
        updatedAt: saved.updatedAt, observedAt }
    }
  } catch { /* Missing/corrupt state is still waiting for a poll. */ }
  return { ...state, ok: false, updatedAt: '', error: '수집 대기 중' }
}
