import type { PrismaClient } from '@prisma/client'

// SQLite's single min()/max() aggregate selects bare columns from the same row.
// Keep each extreme's actual timestamp instead of inventing an average value.
// Both timestamp representations use the (metricId, recordedAt) range index.
export async function readChartHistory(db: PrismaClient, metricId: string, since: number, until: number) {
  const bucketMs = Math.max(1, Math.ceil((until - since + 1) / 1000))
  const rows = await db.$queryRaw<{ value: number; ts: bigint | number }[]>`
    WITH samples AS (
      SELECT value, recordedAt AS ts FROM metric_history
      WHERE metricId=${metricId} AND recordedAt>=${since} AND recordedAt<=${until}
      UNION ALL
      SELECT value, CAST(ROUND((julianday(recordedAt)-2440587.5)*86400000) AS INTEGER) AS ts
      FROM metric_history
      WHERE metricId=${metricId} AND recordedAt>=${new Date(since).toISOString()}
        AND recordedAt<=${new Date(until).toISOString()}
    ), points AS (
      SELECT MIN(value) AS value, ts FROM samples GROUP BY CAST((ts-${since})/${bucketMs} AS INTEGER)
      UNION
      SELECT MAX(value) AS value, ts FROM samples GROUP BY CAST((ts-${since})/${bucketMs} AS INTEGER)
      UNION
      SELECT value, MIN(ts) AS ts FROM samples HAVING COUNT(*)>0
      UNION
      SELECT value, MAX(ts) AS ts FROM samples HAVING COUNT(*)>0
    ) SELECT value, ts FROM points ORDER BY ts`
  return rows.map(row => ({ value: row.value, recordedAt: new Date(Number(row.ts)).toISOString() }))
}
