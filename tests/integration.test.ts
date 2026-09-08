import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { NextRequest } from 'next/server'
import type { DisplayItem, MetricsConfig } from '../src/types'
import { GIMPO, type NearbyStrike } from '../src/lib/lightning-rules'
import { mockWing, wingEvent } from './helpers/wing'
import { runHistoryMaintenanceBatch, pruneOldestHistory } from '../src/worker/history-maintenance'
import { readHistoryStorage } from '../src/lib/history-storage'
import { compact } from '../scripts/compact-history.cjs'

let directory: string
let db: typeof import('../src/lib/db').prisma
let worker: typeof import('../src/worker/db-updater')
let sockets: typeof import('../src/worker/websocket-server')
let systemsApi: typeof import('../src/app/api/systems/route')
let systemApi: typeof import('../src/app/api/systems/[id]/route')
let backupApi: typeof import('../src/app/api/backup/route')
let stateApi: typeof import('../src/app/api/wing15/route')
let checklistApi: typeof import('../src/app/api/wing15/checklist/route')
let confirmApi: typeof import('../src/app/api/wing15/confirm/route')

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tms-review-'))
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`
  process.env.AUDIO_DIR = path.join(directory, 'audio')
  // Choose a free localhost port; never contact the running monitor on 7778.
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  process.env.WS_PORT = String(address.port)
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  execFileSync(process.execPath, [path.resolve('scripts/init-db.js'), path.resolve('prisma/schema.prisma')], {
    env: process.env, stdio: 'pipe',
  })
  db = (await import('../src/lib/db')).prisma
  worker = await import('../src/worker/db-updater')
  sockets = await import('../src/worker/websocket-server')
  systemsApi = await import('../src/app/api/systems/route')
  systemApi = await import('../src/app/api/systems/[id]/route')
  backupApi = await import('../src/app/api/backup/route')
  stateApi = await import('../src/app/api/wing15/route')
  checklistApi = await import('../src/app/api/wing15/checklist/route')
  confirmApi = await import('../src/app/api/wing15/confirm/route')
  await Promise.all([(await import('../src/lib/db')).prismaReady, worker.initDatabasePragmas()])
  sockets.startWebSocketServer()
})

beforeEach(async () => {
  for (const row of await db.system.findMany()) worker.cleanupSystemMaps(row.id)
  await db.$transaction([db.system.deleteMany(), db.alarmLog.deleteMany(), db.setting.deleteMany(), db.siren.deleteMany()])
})

after(async () => {
  sockets?.stopWebSocketServer()
  await delay(50)
  await db?.$disconnect()
  await worker?.closeDatabase()
  // Only remove the directory created by this test run.
  if (directory && path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('tms-review-')) {
    await rm(directory, { recursive: true, force: true })
  }
})

function request(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api/test', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function item(name = '온도'): DisplayItem {
  return { name, index: 0, unit: '°C', warning: null, critical: 30 }
}

async function createSystem(config: MetricsConfig, port = 23001, type = 'sensor') {
  const response = await systemsApi.POST(request({ name: `검증 ${port}`, type, protocol: 'udp', port, encoding: 'utf8', config }))
  assert.equal(response.status, 201, await response.clone().text())
  return response.json() as Promise<{ id: string; name: string }>
}

async function ingest(port: number, value: string) {
  await worker.updateMetric({ system: 'test', type: 'sensor', encoding: 'utf8' }, {
    value, rawLength: value.length, timestamp: new Date(),
  }, port, 'udp')
}

test('both SQLite clients retain their startup pragmas under contention', async () => {
  assert.equal((await readHistoryStorage(db)).incremental, true)
  for (const client of [db, worker.prisma]) {
    const timeout = await client.$queryRawUnsafe<{ timeout: bigint }[]>('PRAGMA busy_timeout')
    const synchronous = await client.$queryRawUnsafe<{ synchronous: bigint }[]>('PRAGMA synchronous')
    assert.equal(Number(timeout[0].timeout), 5000)
    assert.equal(Number(synchronous[0].synchronous), 1)
  }
})

test('startup schedules maintenance without immediately sweeping the collector database', async t => {
  const scheduled: number[] = []
  const originalTimeout = globalThis.setTimeout
  t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    scheduled.push(ms ?? 0)
    return originalTimeout(callback, ms, ...args)
  })
  try {
    worker.startHistoryCleanup()
    assert.deepEqual(scheduled, [60_000])
    assert.equal(await worker.prisma.system.count(), 0)
  } finally { worker.stopHistoryCleanup() }
})

test('indexed history batches preserve recent data and average integer and legacy ISO timestamps together', async () => {
  const now = Date.UTC(2026, 8, 8, 12)
  const day = 86400_000
  const system = await createSystem({ delimiter: ',', displayItems: [item()] })
  const metric = await db.metric.findFirstOrThrow({ where: { systemId: system.id } })
  await db.metricHistory.createMany({ data: [
    { metricId: metric.id, value: 99, recordedAt: new Date(now - 366 * day) },
    { metricId: metric.id, value: 4, recordedAt: new Date(now - 60 * day + 1000) },
    { metricId: metric.id, value: 10, recordedAt: new Date(now - 8 * day + 1000) },
    { metricId: metric.id, value: 20, recordedAt: new Date(now - 8 * day + 2000) },
    { metricId: metric.id, value: 42, recordedAt: new Date(now - day) },
  ] })
  const legacyTime = new Date(now - 60 * day + 2000).toISOString()
  await db.$executeRaw`INSERT INTO metric_history (id, metricId, value, recordedAt) VALUES ('legacy-history', ${metric.id}, 8, ${legacyTime})`
  const plan = await db.$queryRaw<{ detail: string }[]>`EXPLAIN QUERY PLAN SELECT id FROM metric_history WHERE metricId=${metric.id} AND recordedAt>=${now - 365 * day} AND recordedAt<${now} ORDER BY recordedAt LIMIT 2001`
  assert.ok(plan.some(row => row.detail.includes('metric_history_metricId_recordedAt_idx')))
  assert.ok(plan.every(row => !row.detail.includes('SCAN metric_history')))
  assert.equal(await runHistoryMaintenanceBatch(db, now), 1)
  assert.equal(await runHistoryMaintenanceBatch(db, now), 1)
  assert.equal(await runHistoryMaintenanceBatch(db, now), 1)
  const rows = await db.metricHistory.findMany({ where: { metricId: metric.id }, orderBy: { recordedAt: 'asc' } })
  assert.deepEqual(rows.map(row => row.value), [6, 15, 42])
  assert.deepEqual(rows.map(row => row.recordedAt.getTime()), [now - 60 * day, now - 8 * day, now - day])
  assert.equal(await runHistoryMaintenanceBatch(db, now), 0, 'Repeating maintenance must not change completed averages')
})

test('history expiration is bounded and incomplete dense buckets remain intact', async () => {
  const now = Date.UTC(2026, 8, 8, 12)
  const day = 86400_000
  const system = await createSystem({ delimiter: ',', displayItems: [item()] })
  const metric = await db.metric.findFirstOrThrow({ where: { systemId: system.id } })
  await db.metricHistory.createMany({ data: Array.from({ length: 2501 }, (_, i) => ({ metricId: metric.id, value: i, recordedAt: new Date(now - 366 * day + i) })) })
  assert.equal(await runHistoryMaintenanceBatch(db, now), 2000)
  assert.equal(await db.metricHistory.count(), 501)
  assert.equal(await runHistoryMaintenanceBatch(db, now), 501)
  await db.metricHistory.createMany({ data: Array.from({ length: 2501 }, (_, i) => ({ metricId: metric.id, value: i, recordedAt: new Date(now - 60 * day + i) })) })
  await runHistoryMaintenanceBatch(db, now)
  await runHistoryMaintenanceBatch(db, now)
  assert.equal(await db.metricHistory.count(), 2501)
  assert.equal((await db.metricHistory.aggregate({ _sum: { value: true } }))._sum.value, 2500 * 2501 / 2)
})

test('bad ports and malformed config return 400 without partial creation', async () => {
  for (const port of ['23001junk', 0, 65536, 1.5]) {
    const response = await systemsApi.POST(request({ name: 'bad', type: 'sensor', protocol: 'udp', port }))
    assert.equal(response.status, 400)
  }
  const response = await systemsApi.POST(request({ name: 'bad', type: 'ups', protocol: 'udp', port: 23001, config: { displayItems: [item(), item()] } }))
  assert.equal(response.status, 400)
  assert.equal(await db.system.count(), 0)
})

test('capacity cleanup removes oldest history across metrics while preserving settings and alarms', async () => {
  const now = Date.now()
  const system = await createSystem({ delimiter: ',', displayItems: [item(), { ...item('습도'), index: 1 }] })
  const metrics = await db.metric.findMany({ where: { systemId: system.id } })
  await db.setting.create({ data: { key: 'keep-setting', value: 'keep' } })
  await db.alarm.create({ data: { systemId: system.id, severity: 'warning', message: 'keep alarm' } })
  await db.metricHistory.createMany({ data: Array.from({ length: 2100 }, (_, i) => ({ metricId: metrics[i % 2].id, value: i, recordedAt: new Date(now - 10000 + i) })) })
  await db.$executeRaw`INSERT INTO metric_history (id,metricId,value,recordedAt) VALUES ('old-iso',${metrics[0].id},-1,${new Date(now - 20000).toISOString()})`
  assert.equal(await pruneOldestHistory(db, now), 2000)
  assert.equal(await db.metricHistory.count(), 101)
  assert.equal((await db.metricHistory.aggregate({ _min: { value: true } }))._min.value, 1999)
  assert.equal(await db.alarm.count(), 1)
  assert.equal((await db.setting.findUniqueOrThrow({ where: { key: 'keep-setting' } })).value, 'keep')
})

test('offline compaction keeps the newest history within its budget and leaves the source unchanged', async () => {
  const system = await createSystem({ delimiter: ',', displayItems: [item(), { ...item('습도'), index: 1 }] })
  const metrics = await db.metric.findMany({ where: { systemId: system.id } })
  const now = Date.now()
  for (let offset = 0; offset < 20000; offset += 5000) {
    await db.metricHistory.createMany({ data: Array.from({ length: 5000 }, (_, i) => ({ metricId: metrics[(offset + i) % 2].id, value: offset + i, recordedAt: new Date(now - 50000 + offset + i) })) })
  }
  await db.$executeRaw`INSERT INTO metric_history (id,metricId,value,recordedAt) VALUES ('new-iso',${metrics[0].id},12345,${new Date(now - 1000).toISOString()})`
  const destination = path.join(directory, 'compacted.db')
  const result = compact(path.join(directory, 'test.db'), destination, 2)
  assert.ok(result.bytes < 2 * 1024 * 1024)
  assert.ok(result.retained < 20001 && result.retained > 0)
  assert.equal(await db.metricHistory.count(), 20001)
  const { PrismaClient } = await import('@prisma/client')
  const copy = new PrismaClient({ datasourceUrl: 'file:' + destination.replaceAll('\\', '/') })
  try {
    assert.equal(await copy.metricHistory.count(), result.retained)
    assert.equal(await copy.system.count(), 1)
    assert.equal(await copy.metric.count(), 2)
    assert.ok(await copy.metricHistory.findUnique({ where: { id: 'new-iso' } }))
    assert.equal((await copy.metricHistory.aggregate({ _min: { recordedAt: true } }))._min.recordedAt?.toISOString(), result.oldest)
    assert.equal((await readHistoryStorage(copy)).incremental, true)
  } finally { await copy.$disconnect() }
})

test('history capacity settings reject invalid values without storing them', async () => {
  const api = await import('../src/app/api/settings/route')
  for (const value of [0, -1, '5120junk', 511, 10241, true, 512.5]) {
    assert.equal((await api.PUT(request({ historyMaxSizeMb: value }, 'PUT'))).status, 400)
  }
  assert.equal(await db.setting.count(), 0)
  assert.equal((await api.PUT(request({ historyMaxSizeMb: '5120' }, 'PUT'))).status, 200)
  assert.equal((await readHistoryStorage(db)).limitMb, 5120)
})

test('metric deletion and cleared thresholds persist with system edits', async () => {
  const system = await createSystem({ delimiter: ',', displayItems: [item(), { ...item('습도'), index: 1 }] })
  const old = await db.metric.findFirstOrThrow({ where: { systemId: system.id, name: '습도' } })
  await db.metricHistory.create({ data: { metricId: old.id, value: 40 } })
  const response = await systemApi.PATCH(request({ config: { delimiter: ',', displayItems: [{ name: '온도', index: 0, unit: '°C' }] } }, 'PATCH'), { params: Promise.resolve({ id: system.id }) })
  assert.equal(response.status, 200)
  const metrics = await db.metric.findMany({ where: { systemId: system.id } })
  assert.equal(metrics.length, 1)
  assert.equal(metrics[0].criticalThreshold, null)
  assert.equal(await db.metricHistory.count(), 0)
})

test('legacy display thresholds require three confirmed packets, then resolve', async () => {
  const system = await createSystem({ delimiter: ',', displayItems: [item()] }, 23002, 'ups')
  await ingest(23002, '40')
  assert.equal(await db.alarm.count({ where: { severity: 'critical', resolvedAt: null } }), 0)
  await ingest(23002, '40')
  assert.equal(await db.alarm.count({ where: { severity: 'critical', resolvedAt: null } }), 0)
  await ingest(23002, '40')
  assert.equal((await db.system.findUniqueOrThrow({ where: { id: system.id } })).status, 'critical')
  assert.equal(await db.alarm.count({ where: { severity: 'critical', resolvedAt: null } }), 1)
  const raised = await db.alarm.findFirstOrThrow({ where: { resolvedAt: null } })
  for (let i = 0; i < 2; i++) {
    await ingest(23002, '20')
    assert.equal((await db.alarm.findUniqueOrThrow({ where: { id: raised.id } })).resolvedAt, null)
  }
  await ingest(23002, '20')
  assert.equal((await db.system.findUniqueOrThrow({ where: { id: system.id } })).status, 'normal')
  assert.equal(await db.alarm.count({ where: { resolvedAt: null } }), 0)
  assert.equal(await db.alarmLog.count(), 1)
})

test('shared-port empty parser results do not keep another device alive', async () => {
  const a = await createSystem({ delimiter: ',', displayItems: [item()], customCode: 'return raw.startsWith("A") ? { "온도": 20 } : {}' }, 23003)
  const b = await createSystem({ delimiter: ',', displayItems: [item()], customCode: 'return raw.startsWith("B") ? { "온도": 20 } : {}' }, 23003)
  await ingest(23003, 'B20')
  assert.equal((await db.system.findUniqueOrThrow({ where: { id: a.id } })).lastDataAt, null)
  assert.ok((await db.system.findUniqueOrThrow({ where: { id: b.id } })).lastDataAt)
})

test('settings recalculation honors textual metrics and disabled alarms', async () => {
  const statusItem = { ...item('상태'), unit: '', conditions: { normal: [], critical: [{ operator: 'neq' as const, value1: 0, value2: null, stringValue: 'ONLINE' }], coldCritical: [], dryCritical: [], humidCritical: [] } }
  const config = { delimiter: ',', displayItems: [statusItem], customCode: 'return { "상태": raw }' }
  const system = await createSystem(config, 23004, 'ups')
  for (let i = 0; i < 3; i++) await ingest(23004, 'ONBATT')
  const params = { params: Promise.resolve({ id: system.id }) }
  assert.equal((await systemApi.PATCH(request({ config }, 'PATCH'), params)).status, 200)
  assert.equal((await db.system.findUniqueOrThrow({ where: { id: system.id } })).status, 'critical')
  config.displayItems[0] = { ...statusItem, alarmEnabled: false } as typeof statusItem
  assert.equal((await systemApi.PATCH(request({ config }, 'PATCH'), params)).status, 200)
  assert.equal((await db.system.findUniqueOrThrow({ where: { id: system.id } })).status, 'normal')
  assert.equal(await db.alarm.count({ where: { resolvedAt: null } }), 0)
})

test('backup round-trip succeeds and malformed restore leaves existing data intact', async () => {
  await createSystem({ delimiter: ',', displayItems: [item()] })
  const backup = await (await backupApi.GET()).json()
  assert.equal((await backupApi.POST(request({ version: '2.0', systems: [] }))).status, 400)
  assert.equal(await db.system.count(), 1)
  const corrupt = structuredClone(backup)
  corrupt.systems[0].metrics[0].createdAt = 'bad-date'
  assert.equal((await backupApi.POST(request(corrupt))).status, 400)
  assert.equal(await db.system.count(), 1)
  assert.equal((await backupApi.POST(request(backup))).status, 200)
  assert.equal(await db.system.count(), 1)
})

test('websocket relays system, resolution, configuration and lightning notifications', async () => {
  const receiver = new WebSocket(`ws://127.0.0.1:${process.env.WS_PORT}`)
  const sender = new WebSocket(`ws://127.0.0.1:${process.env.WS_PORT}`)
  const received: string[] = []
  receiver.on('message', data => received.push(JSON.parse(data.toString()).type))
  try {
    await Promise.all([once(receiver, 'open'), once(sender, 'open')])
    for (const type of ['system', 'alarm-resolved', 'systems-changed', 'wing15']) {
      sender.send(JSON.stringify({ type, data: {}, timestamp: new Date().toISOString() }))
    }
    for (let tries = 0; tries < 50 && !received.includes('wing15'); tries++) await delay(10)
    for (const type of ['system', 'alarm-resolved', 'systems-changed', 'wing15']) assert.ok(received.includes(type), type)
  } finally { sender.terminate(); receiver.terminate() }
})

test('stale lightning inspection is rejected before any external confirmation', async () => {
  await db.setting.create({ data: { key: 'wing15Strikes', value: JSON.stringify([{ detectedAt: Date.now() - 2 * 3600_000, distanceKm: 2 }]) } })
  await db.setting.create({ data: { key: 'wing15State', value: JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }) } })
  const state = await (await stateApi.GET()).json()
  const invalid = await checklistApi.PUT(new NextRequest(request({ sig: 'old', special: true, maintenance: true }, 'PUT')))
  assert.equal(invalid.status, 409)
  const valid = await checklistApi.PUT(new NextRequest(request({ sig: state.sig, special: true, maintenance: true }, 'PUT')))
  assert.equal(valid.status, 200)
  assert.equal((await confirmApi.POST(request({ sig: 'old' }))).status, 409)
  assert.equal(await db.setting.count({ where: { key: 'wing15ConfirmedAt' } }), 0)
})

async function prepareLightningReview(strikes: NearbyStrike[]) {
  await db.setting.createMany({ data: [
    { key: 'wing15Strikes', value: JSON.stringify(strikes) },
    { key: 'wing15State', value: JSON.stringify({ ok: true, updatedAt: new Date().toISOString(), observedAt: new Date().toISOString() }) },
  ] })
  const state = await (await stateApi.GET()).json()
  const checked = await checklistApi.PUT(new NextRequest(request({ sig: state.sig, special: true, maintenance: true }, 'PUT')))
  assert.equal(checked.status, 200)
  return state
}

test('background collection, dashboard and checklist access only the public weather source', async t => {
  const now = Date.now()
  const legacy = { detectedAt: now - 3 * 3600_000, distanceKm: 0 }
  const pending = { detectedAt: now - 2 * 3600_000, distanceKm: 0 }
  await db.setting.createMany({ data: [
    { key: 'wing15Strikes', value: JSON.stringify([legacy]) },
    { key: 'wing15ConfirmedAt', value: new Date(legacy.detectedAt).toISOString() },
  ] })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'www.weather.go.kr', 'Background activity must never access WING')
    assert.equal(new Headers(init?.headers).get('authorization'), null)
    calls++
    return Response.json({ baseDateList: [new Date(now).toISOString()], lgtList: [legacy, pending].map(strike => ({
      date: new Date(strike.detectedAt).toISOString(), type: '1', lat: GIMPO.lat, lon: GIMPO.lon,
    })) })
  })
  const monitor = await import('../src/worker/wing15-monitor')
  const receiver = new WebSocket(`ws://127.0.0.1:${process.env.WS_PORT}`)
  try {
    await once(receiver, 'open')
    const published = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Lightning poll did not publish')), 5000)
      receiver.on('message', data => {
        const message = JSON.parse(data.toString())
        if (message.type === 'wing15' && message.data.wing15.observedAt === new Date(now).toISOString()) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })
    monitor.startWing15Monitor()
    await published
    const state = await (await stateApi.GET()).json()
    assert.equal(state.ok, true)
    const checked = await checklistApi.PUT(new NextRequest(request({ sig: state.sig, special: true, maintenance: true }, 'PUT')))
    assert.equal(checked.status, 200)
    const history = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'wing15Strikes' } })).value) as NearbyStrike[]
    assert.equal(history.length, 2)
    assert.equal(history[0].confirmed, true, 'Legacy confirmations survive the source migration')
    assert.equal(history[1].confirmed, false)
    assert.equal(calls, 1)
  } finally {
    monitor.stopWing15Monitor()
    receiver.terminate()
  }
})

test('lightning timeout retries after cooldown, preserves review and publishes recovery', async t => {
  let clock = Date.now() + 120_000
  t.mock.method(Date, 'now', () => clock)
  const strike: NearbyStrike = { detectedAt: clock - 2 * 3600_000, distanceKm: 0, lat: GIMPO.lat, lon: GIMPO.lon, confirmed: false }
  await prepareLightningReview([strike])
  const initial = await (await stateApi.GET()).json()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    assert.equal(new URL(String(input)).hostname, 'www.weather.go.kr')
    if (++calls === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    return Response.json({ baseDateList: [new Date(clock).toISOString()], lgtList: [] })
  })
  const originalTimeout = globalThis.setTimeout
  const retries: { run: () => void; timer: ReturnType<typeof setTimeout> }[] = []
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms?: number, ...args: unknown[]) => {
    if (ms === 60_000) {
      const timer = originalTimeout(() => {}, ms)
      retries.push({ run: callback, timer })
      return timer
    }
    return originalTimeout(callback, ms, ...args)
  })
  const monitor = await import('../src/worker/wing15-monitor')
  const receiver = new WebSocket(`ws://127.0.0.1:${process.env.WS_PORT}`)
  const nextState = (ok: boolean) => new Promise<void>((resolve, reject) => {
    const timeout = originalTimeout(() => reject(new Error('Lightning poll did not publish')), 5000)
    const listener = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString())
      if (message.type !== 'wing15' || message.data.wing15.ok !== ok) return
      clearTimeout(timeout)
      receiver.off('message', listener)
      resolve()
    }
    receiver.on('message', listener)
  })
  try {
    await once(receiver, 'open')
    const failed = nextState(false)
    monitor.startWing15Monitor()
    await failed
    const state = await (await stateApi.GET()).json()
    assert.equal(state.ok, false)
    assert.match(state.error, /응답 시간 초과/)
    assert.equal(state.sig, initial.sig)
    assert.deepEqual(state.checklist, initial.checklist)
    assert.equal(retries.length, 1, 'A failed poll schedules a 60-second retry')

    const repeated = nextState(false)
    monitor.triggerWing15Poll()
    await repeated
    assert.equal(calls, 1, 'Manual triggers still share the failed request during cooldown')
    assert.equal(retries.length, 2)

    clock += 60_000
    const recovered = nextState(true)
    retries[1].run()
    await recovered
    const fresh = await (await stateApi.GET()).json()
    assert.equal(fresh.ok, true)
    assert.equal(fresh.error, undefined)
    assert.equal(fresh.observedAt, new Date(clock).toISOString())
    assert.deepEqual(fresh.checklist, initial.checklist)
    assert.equal(fresh.items[0].confirmed, false)
    assert.equal(calls, 2)
    assert.equal(retries.length, 2, 'Recovery returns to the normal polling interval')
  } finally {
    monitor.stopWing15Monitor()
    receiver.terminate()
    for (const retry of retries) clearTimeout(retry.timer)
  }
})

test('WING delay leaves review intact and retry confirms only after remote persistence', async t => {
  const strike: NearbyStrike = { detectedAt: Date.now() - 2 * 3600_000, distanceKm: 0, lat: GIMPO.lat, lon: GIMPO.lon, confirmed: false }
  const state = await prepareLightningReview([strike])
  const remote = mockWing(t, [])
  const pending = await confirmApi.POST(request({ sig: state.sig }))
  assert.equal(pending.status, 409)
  assert.match((await pending.json()).error, /WING/)
  assert.equal(await db.setting.count({ where: { key: 'wing15ConfirmedAt' } }), 0)
  assert.equal(remote.writes.length, 0)
  assert.equal((await (await stateApi.GET()).json()).checklist.special, true)

  remote.events.push(wingEvent(strike, 1))
  remote.persistWrites = false
  assert.equal((await confirmApi.POST(request({ sig: state.sig }))).status, 500)
  assert.equal(await db.setting.count({ where: { key: 'wing15ConfirmedAt' } }), 0)

  remote.persistWrites = true
  const confirmed = await confirmApi.POST(request({ sig: state.sig }))
  assert.equal(confirmed.status, 200)
  assert.deepEqual((await confirmed.json()).items, [])
  assert.equal(JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'wing15Strikes' } })).value)[0].confirmed, true)
})

test('strikes arriving during WING confirmation remain unconfirmed, including older observations', async t => {
  const now = Date.now()
  const reviewed: NearbyStrike = { detectedAt: now - 2 * 3600_000, distanceKm: 0, lat: GIMPO.lat, lon: GIMPO.lon, confirmed: false }
  const newer = { ...reviewed, detectedAt: now - 30 * 60_000 }
  const late = { ...reviewed, detectedAt: now - 3 * 3600_000 }
  const state = await prepareLightningReview([reviewed])
  const remote = mockWing(t, [wingEvent(reviewed, 1)])
  remote.onWrite = async () => {
    await db.setting.update({ where: { key: 'wing15Strikes' }, data: { value: JSON.stringify([reviewed, newer, late]) } })
  }
  const response = await confirmApi.POST(request({ sig: state.sig }))
  assert.equal(response.status, 200)
  const next = await response.json()
  assert.equal(next.items[0].confirmed, false)
  assert.equal(next.items[0].active, true)
  assert.notEqual(next.sig, state.sig)
  assert.equal(next.checklist.special, false)
  const history = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'wing15Strikes' } })).value) as NearbyStrike[]
  assert.equal(history.find(item => item.detectedAt === reviewed.detectedAt)?.confirmed, true)
  assert.equal(history.find(item => item.detectedAt === newer.detectedAt)?.confirmed, false)
  assert.equal(history.find(item => item.detectedAt === late.detectedAt)?.confirmed, false)
  assert.equal(remote.inspections.size, 1)
})

test('stale observation clock blocks confirmation even when the last poll said OK', async t => {
  const strike: NearbyStrike = { detectedAt: Date.now() - 2 * 3600_000, distanceKm: 0, confirmed: false }
  const state = await prepareLightningReview([strike])
  await db.setting.update({ where: { key: 'wing15State' }, data: { value: JSON.stringify({
    ok: true, updatedAt: new Date().toISOString(), observedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  }) } })
  const remote = mockWing(t, [])
  const stale = await (await stateApi.GET()).json()
  assert.equal(stale.ok, false)
  assert.equal(stale.items.length, 1)
  assert.equal((await confirmApi.POST(request({ sig: state.sig }))).status, 409)
  assert.equal(remote.eventReads, 0)
  assert.equal(remote.writes.length, 0)
})

test('audio upload uses actual format and persistent storage; non-WAVE RIFF is rejected', async () => {
  const { POST } = await import('../src/app/api/audio/upload/route')
  const { GET } = await import('../src/app/api/audio/[filename]/route')
  const upload = async (bytes: Uint8Array) => {
    const form = new FormData()
    form.set('file', new File([Uint8Array.from(bytes)], 'recording.txt', { type: 'audio/wav' }))
    return POST(new NextRequest('http://localhost/api/audio/upload', { method: 'POST', body: form }))
  }
  assert.equal((await upload(Buffer.from('RIFFxxxxAVI '))).status, 400)
  const response = await upload(Buffer.from('RIFFxxxxWAVE'))
  assert.equal(response.status, 200)
  const { fileName, url } = await response.json()
  assert.ok(fileName.endsWith('.wav'))
  assert.equal(url, `/api/audio/${fileName}`)
  const downloaded = await GET(new NextRequest('http://localhost'), { params: Promise.resolve({ filename: fileName }) })
  assert.equal(downloaded.status, 200)
  assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString(), 'RIFFxxxxWAVE')
})
