import type { Prisma, PrismaClient } from '@prisma/client'
import { readHistoryStorage } from '@/lib/history-storage'

const DAY = 24 * 3600_000
const BATCH_SIZE = 2000
const POSITION_KEY = 'historyCleanupPosition'

interface HistoryRow { id: string; value: number; recordedAt: string; storage: string }
interface Progress { thirty?: number; ten?: number }

function timestamp(row: HistoryRow): number {
  const time = row.storage === 'integer' || row.storage === 'real' ? Number(row.recordedAt) : Date.parse(row.recordedAt)
  if (!Number.isFinite(time) || !Number.isFinite(row.value)) throw new Error('Invalid historical metric value or timestamp')
  return time
}

async function save(tx: Prisma.TransactionClient, key: string, value: string) {
  await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value, category: 'history' } })
}

async function removeRows(tx: Prisma.TransactionClient, rows: { id: string }[]) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    await tx.metricHistory.deleteMany({ where: { id: { in: rows.slice(offset, offset + 500).map(row => row.id) } } })
  }
}

// Both branches use the existing (metricId, recordedAt) index. Prisma writes
// integer milliseconds; older raw SQL wrote ISO text, which must also survive.
async function readRange(tx: Prisma.TransactionClient, metricId: string, since: number, until: number) {
  const numeric = await tx.$queryRaw<HistoryRow[]>`SELECT id, value, CAST(recordedAt AS TEXT) AS recordedAt, typeof(recordedAt) AS storage
    FROM metric_history WHERE metricId=${metricId} AND recordedAt>=${since} AND recordedAt<${until}
    ORDER BY recordedAt LIMIT ${BATCH_SIZE + 1}`
  const text = await tx.$queryRaw<HistoryRow[]>`SELECT id, value, CAST(recordedAt AS TEXT) AS recordedAt, typeof(recordedAt) AS storage
    FROM metric_history WHERE metricId=${metricId} AND recordedAt>=${new Date(since).toISOString()} AND recordedAt<${new Date(until).toISOString()}
    ORDER BY recordedAt LIMIT ${BATCH_SIZE + 1}`
  return { numeric, text }
}

export async function pruneOldestHistory(db: PrismaClient, now = Date.now()): Promise<number> {
  return db.$transaction(async tx => {
    // Query each storage representation through the recordedAt index, then
    // merge chronologically so legacy ISO rows cannot hide behind integers.
    const numeric = await tx.$queryRaw<HistoryRow[]>`SELECT id, value, CAST(recordedAt AS TEXT) AS recordedAt, typeof(recordedAt) AS storage
      FROM metric_history WHERE recordedAt>=0 AND recordedAt<${now} ORDER BY recordedAt LIMIT ${BATCH_SIZE}`
    const text = await tx.$queryRaw<HistoryRow[]>`SELECT id, value, CAST(recordedAt AS TEXT) AS recordedAt, typeof(recordedAt) AS storage
      FROM metric_history WHERE recordedAt>='0000-01-01T00:00:00.000Z' AND recordedAt<${new Date(now).toISOString()} ORDER BY recordedAt LIMIT ${BATCH_SIZE}`
    const oldest = [...numeric, ...text].sort((a, b) => timestamp(a) - timestamp(b)).slice(0, BATCH_SIZE)
    await removeRows(tx, oldest)
    return oldest.length
  }, { maxWait: 1000, timeout: 5000 })
}

// One short transaction per tick, with a persisted per-metric cursor. No query
// scans the entire history table or holds the collector connection for a year.
export async function runHistoryMaintenanceBatch(db: PrismaClient, now = Date.now()): Promise<number> {
  const storage = await readHistoryStorage(db)
  if (storage.usedBytes >= storage.limitMb * 1024 * 1024 * 0.9) {
    const reduced = await pruneOldestHistory(db, now)
    if (storage.incremental) await db.$queryRawUnsafe('PRAGMA incremental_vacuum(256)')
    return reduced
  }
  if (storage.incremental && storage.freePages > 256) await db.$queryRawUnsafe('PRAGMA incremental_vacuum(256)')
  return db.$transaction(async tx => {
    const position = (await tx.setting.findUnique({ where: { key: POSITION_KEY } }))?.value
    const select = { id: true } as const
    const metric = await tx.metric.findFirst({ where: position ? { id: { gt: position } } : {}, select, orderBy: { id: 'asc' } })
      ?? await tx.metric.findFirst({ select, orderBy: { id: 'asc' } })
    const cutoff = now - 365 * DAY
    const alarmLogs = await tx.alarmLog.findMany({ where: { createdAt: { lt: new Date(cutoff) } }, select, orderBy: { createdAt: 'asc' }, take: 500 })
    if (alarmLogs.length) await tx.alarmLog.deleteMany({ where: { id: { in: alarmLogs.map(row => row.id) } } })
    if (!metric) return 0

    const progressKey = 'historyCleanup:' + metric.id
    const saved = (await tx.setting.findUnique({ where: { key: progressKey } }))?.value
    let progress: Progress = {}
    try {
      const parsed = JSON.parse(saved ?? '{}')
      if (parsed && typeof parsed === 'object') progress = parsed
    } catch { /* A missing or invalid cursor safely restarts indexed traversal. */ }

    const expired = await readRange(tx, metric.id, Date.parse('0000-01-01T00:00:00Z'), cutoff)
    const expiredRows = [...expired.numeric.slice(0, BATCH_SIZE), ...expired.text.slice(0, BATCH_SIZE)]
    await removeRows(tx, expiredRows)
    let reduced = expiredRows.length
    if (!expiredRows.length) {
      for (const [key, days, minutes, lowerDays] of [['thirty', 31, 30, 365], ['ten', 7, 10, 31]] as const) {
        const interval = minutes * 60_000
        const lower = now - lowerDays * DAY
        const until = Math.floor((now - days * DAY) / interval) * interval
        const cursor = progress[key]
        const since = Math.max(lower, typeof cursor === 'number' && Number.isFinite(cursor) && cursor <= until ? cursor : lower)
        if (since >= until) continue
        const ranges = await readRange(tx, metric.id, since, until)
        const truncatedAt = Math.min(...[ranges.numeric, ranges.text].map(rows => rows.length > BATCH_SIZE ? timestamp(rows[BATCH_SIZE]) : until))
        const completeUntil = Math.floor(truncatedAt / interval) * interval
        const groups = new Map<number, HistoryRow[]>()
        for (const row of [...ranges.numeric, ...ranges.text]) {
          const time = timestamp(row)
          if (time >= completeUntil) continue
          const bucket = Math.floor(time / interval) * interval
          const group = groups.get(bucket) ?? []
          group.push(row)
          groups.set(bucket, group)
        }
        for (const [bucket, rows] of groups) {
          if (rows.length < 2) continue
          await removeRows(tx, rows)
          await tx.metricHistory.create({ data: { metricId: metric.id, value: rows.reduce((sum, row) => sum + row.value / rows.length, 0), recordedAt: new Date(Math.max(bucket, lower)) } })
          reduced += rows.length - 1
        }
        // An unusually dense, incomplete bucket stays raw; never average a
        // partial bucket or discard its unseen rows to fit a batch limit.
        progress[key] = completeUntil > since ? completeUntil : Math.floor(since / interval) * interval + interval
        if (ranges.numeric.length || ranges.text.length) break
      }
    }
    await save(tx, progressKey, JSON.stringify(progress))
    await save(tx, POSITION_KEY, metric.id)
    return reduced
  }, { maxWait: 1000, timeout: 5000 })
}
