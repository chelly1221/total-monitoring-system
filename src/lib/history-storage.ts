import type { Prisma } from '@prisma/client'

export const DEFAULT_HISTORY_MAX_MB = 5120
export const HISTORY_LIMIT_KEY = 'historyMaxSizeMb'

export function validHistoryLimit(value: unknown): boolean {
  return (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) &&
    Number.isInteger(Number(value)) && Number(value) >= 512 && Number(value) <= 10240
}

export async function readHistoryStorage(db: Prisma.TransactionClient) {
  const setting = await db.setting.findUnique({ where: { key: HISTORY_LIMIT_KEY } })
  const limitMb = validHistoryLimit(setting?.value) ? Number(setting!.value) : DEFAULT_HISTORY_MAX_MB
  const [usage] = await db.$queryRaw<{ pages: bigint; free: bigint; size: bigint; vacuum: bigint }[]>`
    SELECT (SELECT page_count FROM pragma_page_count) AS pages,
      (SELECT freelist_count FROM pragma_freelist_count) AS free,
      (SELECT page_size FROM pragma_page_size) AS size,
      (SELECT auto_vacuum FROM pragma_auto_vacuum) AS vacuum`
  const bytes = Number(usage.pages) * Number(usage.size)
  const usedBytes = (Number(usage.pages) - Number(usage.free)) * Number(usage.size)
  return { limitMb, bytes, usedBytes, freePages: Number(usage.free), incremental: Number(usage.vacuum) === 2 }
}
