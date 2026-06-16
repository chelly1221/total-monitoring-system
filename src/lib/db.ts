import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Pin a single SQLite connection so the per-connection busy_timeout pragma below
// applies to every query (Prisma's default pool would leave most connections with
// busy_timeout=0 = fail instantly under contention).
function withConnectionLimit(url: string): string {
  if (/[?&]connection_limit=/.test(url)) return url
  return url + (url.includes('?') ? '&' : '?') + 'connection_limit=1'
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasourceUrl: withConnectionLimit(process.env.DATABASE_URL || 'file:./dev.db') })

// Match the worker's SQLite pragmas so the two processes share the file without
// blocking each other: WAL enables concurrent reader/writer, busy_timeout makes a
// contended query wait instead of throwing SQLITE_BUSY. Run once per process.
if (!globalForPrisma.prisma) {
  void prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {})
  void prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000;').catch(() => {})
  void prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;').catch(() => {})
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
