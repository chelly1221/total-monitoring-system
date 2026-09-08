import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PrismaClient } from '@prisma/client'
import { recordMetricHistory } from '../src/worker/history-writer'

test('capacity guard pauses only history, recovers after cleanup, and contains storage failures', async t => {
  let now = Date.now()
  let pages = BigInt(131072)
  let writes = 0
  let failure = false
  t.mock.method(Date, 'now', () => now)
  const db = {
    setting: { findUnique: async () => ({ value: '512' }) },
    $queryRaw: async () => [{ pages, free: BigInt(0), size: BigInt(4096), vacuum: BigInt(2) }],
    metricHistory: { create: async () => { if (failure) throw new Error('Disk full'); writes++ } },
  } as unknown as PrismaClient
  assert.equal(await recordMetricHistory(db, { metricId: 'metric', value: 1 }), false)
  assert.equal(writes, 0)
  pages = BigInt(100)
  now += 1001
  assert.equal(await recordMetricHistory(db, { metricId: 'metric', value: 2 }), true)
  assert.equal(writes, 1)
  failure = true
  assert.equal(await recordMetricHistory(db, { metricId: 'metric', value: 3 }), false)
})
