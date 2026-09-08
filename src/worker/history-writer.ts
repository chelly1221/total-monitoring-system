import type { PrismaClient } from '@prisma/client'
import { readHistoryStorage } from '@/lib/history-storage'
import { createLogger } from '@/lib/logger'

const log = createLogger('history-writer')
const checks = new WeakMap<PrismaClient, { at: number; pending: Promise<boolean> }>()
let lastWarning = -Infinity

// Reserve room for current metrics, settings and alarms while the bounded
// cleanup catches up. Share the inexpensive page-count check for one second.
export async function recordMetricHistory(db: PrismaClient, data: { metricId: string; value: number }): Promise<boolean> {
  try {
    const now = Date.now()
    let check = checks.get(db)
    if (!check || now - check.at >= 1000) {
      check = { at: now, pending: readHistoryStorage(db).then(state => state.usedBytes < state.limitMb * 1024 * 1024 * 0.98) }
      checks.set(db, check)
    }
    if (!await check.pending) {
      if (now - lastWarning >= 60_000) {
        log.warn('이력 용량 상한 도달: 오래된 이력 정리 중, 실시간 감시·알람은 계속 처리합니다')
        lastWarning = now
      }
      return false
    }
    await db.metricHistory.create({ data })
    return true
  } catch (error) {
    if (Date.now() - lastWarning >= 60_000) {
      log.error('이력 저장 실패:', error)
      lastWarning = Date.now()
    }
    return false
  }
}
