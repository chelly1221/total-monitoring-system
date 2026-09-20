import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMetricUpdates, createRefreshQueue } from '../src/lib/realtime-updates'
import type { PrismaSystem } from '../src/types'

test('metric batches preserve unrelated systems and discard updates for removed metrics', () => {
  const systems = [
    { id: 'a', metrics: [{ id: 'one', value: 10 }, { id: 'two', value: 20 }] },
    { id: 'b', metrics: [{ id: 'three', value: 30 }] },
  ] as PrismaSystem[]
  const updated = applyMetricUpdates(systems, new Map([['one', { value: 11 }]]))
  assert.equal(updated[0].metrics![0].value, 11)
  assert.equal(updated[0].metrics![1], systems[0].metrics![1])
  assert.equal(updated[1], systems[1])
  assert.equal(systems[0].metrics![0].value, 10)
  assert.equal(applyMetricUpdates(systems, new Map([['removed', { value: 5 }]])), systems)
})

test('refresh bursts share one request and retain a trailing save without overlap', async () => {
  const releases: (() => void)[] = []
  let calls = 0
  const refresh = createRefreshQueue(async () => {
    calls++
    await new Promise<void>(resolve => releases.push(resolve))
  })
  const first = refresh()
  assert.equal(refresh(), first)
  await Promise.resolve()
  assert.equal(calls, 1)
  for (let i = 0; i < 20; i++) assert.equal(refresh(), first)
  assert.equal(calls, 1)
  releases.shift()!()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  releases.shift()!()
  await first
  assert.equal(calls, 2)
})

test('a failed refresh releases the queue for recovery', async () => {
  let calls = 0
  const refresh = createRefreshQueue(async () => {
    if (++calls === 1) throw new Error('offline')
  })
  await assert.rejects(refresh(), /offline/)
  await refresh()
  assert.equal(calls, 2)
})
