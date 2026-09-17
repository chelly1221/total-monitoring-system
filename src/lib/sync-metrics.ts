import { prisma } from '@/lib/db'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { MetricsConfig, DisplayItem } from '@/types'

/**
 * Extract representative threshold from conditions for gauge display
 */
export function extractRepresentativeThreshold(conditions: DisplayItem['conditions'], type: 'warning' | 'critical'): number | null {
  if (!conditions) return null
  if (type === 'warning') return null
  const list = [...(conditions.critical || []), ...(conditions.coldCritical || []),
     ...(conditions.dryCritical || []), ...(conditions.humidCritical || [])]
  // Pick the first gte condition's value, or first condition's value1
  const gteCondition = list.find(c => c.operator === 'gte')
  if (gteCondition) return gteCondition.value1
  if (list.length > 0) return list[0].value1
  return null
}

/**
 * Sync displayItems from config to Metric table
 * Creates or updates metrics based on config.displayItems.
 *
 * Returns the ids of metrics whose names are no longer in the config. They are
 * NOT deleted here: deleting a metric cascades into its history, which for a
 * year of readings takes far longer than an interactive transaction allows
 * (P2028 "Transaction not found"). Call removeMetrics() with the result after
 * the transaction has committed.
 */
export async function syncMetricsFromConfig(systemId: string, config: MetricsConfig, db: Prisma.TransactionClient = prisma): Promise<string[]> {
  if (!config.displayItems || !Array.isArray(config.displayItems)) {
    return []
  }

  const existing = await db.metric.findMany({ where: { systemId }, select: { id: true, name: true } })
  const byName = new Map(existing.map(metric => [metric.name, metric.id]))

  for (const item of config.displayItems) {
    // Use conditions-based thresholds if available, otherwise fall back to legacy
    const warningThreshold = item.conditions
      ? extractRepresentativeThreshold(item.conditions, 'warning')
      : item.warning ?? null
    const criticalThreshold = item.conditions
      ? extractRepresentativeThreshold(item.conditions, 'critical')
      : item.critical ?? null

    const existingId = byName.get(item.name)
    if (existingId) {
      await db.metric.update({
        where: { id: existingId },
        data: {
          warningThreshold,
          criticalThreshold,
          unit: item.unit,
        },
      })
    } else {
      await db.metric.create({
        data: {
          systemId,
          name: item.name,
          value: 0,
          unit: item.unit,
          warningThreshold,
          criticalThreshold,
        },
      })
    }
  }

  // Removed/renamed items must not leave stale values and thresholds on the dashboard.
  const names = new Set(config.displayItems.map(item => item.name))
  return existing.filter(metric => !names.has(metric.name)).map(metric => metric.id)
}

const HISTORY_DELETE_BATCH = 5000

/**
 * Delete metrics together with their history, outside any transaction.
 * The history goes in short batches so each statement releases the SQLite write
 * lock quickly and the worker's inserts interleave instead of hitting busy_timeout.
 */
export async function removeMetrics(metricIds: string[], db: PrismaClient = prisma): Promise<void> {
  for (const metricId of metricIds) {
    for (;;) {
      const removed = await db.$executeRaw`DELETE FROM metric_history WHERE rowid IN (
        SELECT rowid FROM metric_history WHERE metricId = ${metricId} LIMIT ${HISTORY_DELETE_BATCH})`
      if (removed < HISTORY_DELETE_BATCH) break
    }
  }
  if (metricIds.length > 0) {
    await db.metric.deleteMany({ where: { id: { in: metricIds } } })
  }
}
