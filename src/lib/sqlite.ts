import type { PrismaClient } from '@prisma/client'
import { setTimeout as delay } from 'node:timers/promises'

export async function applySqlitePragmas(client: PrismaClient): Promise<void> {
  // Set the wait policy first: changing journal mode itself can contend with
  // the other process during simultaneous first startup.
  await client.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
  for (let attempt = 0; ; attempt++) {
    try {
      await client.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
      break
    } catch (error) {
      // SQLite can reject a journal-mode lock upgrade immediately, even with
      // busy_timeout set. Retry after the other startup connection releases it.
      const code = (error as { meta?: { code?: string } }).meta?.code
      if (attempt >= 4 || (code !== '5' && code !== '6')) throw error
      await delay(50 * (attempt + 1))
    }
  }
  await client.$queryRawUnsafe('PRAGMA synchronous=NORMAL;')
}
