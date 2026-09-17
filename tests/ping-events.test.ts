import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  currentlyFailedTargets,
  describePingEvent,
  parsePingEvent,
  parsePingEventReport,
  summarizeFailures,
  supportsTransferForKind,
} from './helpers/ping-rules'

test('client reports are validated event by event', () => {
  assert.equal(parsePingEventReport(null), null)
  assert.equal(parsePingEventReport({ events: [] }), null)
  assert.equal(parsePingEventReport({ id: 'c1' }), null)
  const report = parsePingEventReport({
    id: 'c1', name: '1레이더 네트워크', host: 'RADAR1',
    events: [
      { at: 1758000000000, name: '1레이더 스위치', address: '192.168.0.5', status: '장애 발생', rttMs: null, sent: 10, lost: 3, consecutiveFailures: 3 },
      { at: 1758000005000, name: '1레이더 스위치', address: '192.168.0.5', status: '정상 복구', rttMs: 2, sent: 11, lost: 3, consecutiveFailures: 0 },
      { at: 'bad', address: '1.1.1.1', status: '장애 발생' },
      { at: 1758000006000, address: '1.1.1.1', status: '알 수 없음' },
      { at: 1758000007000, status: '장애 발생' },
    ],
  })
  assert.ok(report)
  assert.equal(report.clientId, 'c1')
  assert.equal(report.events.length, 2)
  assert.equal(report.events[0].occurredAt.getTime(), 1758000000000)
  assert.equal(report.events[0].targetName, '1레이더 스위치')
  assert.equal(report.events[1].rttMs, 2)
  assert.equal(parsePingEvent({ at: 1, address: '10.0.0.1', status: '장애 발생' })?.targetName, '10.0.0.1')
})

test('failure summaries name the target and the streak', () => {
  assert.equal(describePingEvent({ targetName: '1레이더 스위치', address: '192.168.0.5', status: '장애 발생', consecutiveFailures: 3, rttMs: null }), '1레이더 스위치 192.168.0.5 응답 없음 (3회 연속)')
  assert.equal(describePingEvent({ targetName: '192.168.0.5', address: '192.168.0.5', status: '장애 발생', consecutiveFailures: 1, rttMs: null }), '192.168.0.5 응답 없음')
  assert.equal(describePingEvent({ targetName: 'GW', address: '10.0.0.1', status: '정상 복구', consecutiveFailures: 0, rttMs: 4 }), 'GW 10.0.0.1 응답 복구 (4ms)')
  const many = Array.from({ length: 5 }, (_, i) => ({ targetName: `T${i}`, address: `10.0.0.${i}`, status: '장애 발생', consecutiveFailures: 1, rttMs: null }))
  assert.match(summarizeFailures(many), /외 2건$/)
})

test('a target counts as failed until a later recovery for the same address', () => {
  const t = (ms: number) => new Date(1758000000000 + ms)
  const events = [
    { address: 'a', status: '장애 발생', occurredAt: t(0) },
    { address: 'b', status: '장애 발생', occurredAt: t(1000) },
    { address: 'a', status: '정상 복구', occurredAt: t(2000) },
    { address: 'c', status: '정상 복구', occurredAt: t(3000) },
  ]
  const failed = currentlyFailedTargets(events)
  assert.deepEqual(failed.map(e => e.address), ['b'])
  // Order of arrival must not matter.
  assert.deepEqual(currentlyFailedTargets([...events].reverse()).map(e => e.address), ['b'])
})

test('transfer support is gated per client kind', () => {
  assert.ok(supportsTransferForKind('3.2.0', 'sound'))
  assert.ok(!supportsTransferForKind('3.1.0', 'sound'))
  assert.ok(!supportsTransferForKind('1.1.0', 'sound'))
  assert.ok(supportsTransferForKind('1.1.0', 'ping'))
  assert.ok(!supportsTransferForKind('1.0.2', 'ping'))
  assert.ok(supportsTransferForKind('1.0.0', 'ups'))
  assert.ok(!supportsTransferForKind('0.9.9', 'ups'))
})

// ---------------------------------------------------------------- database-backed

let directory: string
let db: typeof import('../src/lib/db').prisma
let store: typeof import('../src/lib/ping-events')

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tms-ping-events-'))
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`
  execFileSync(process.execPath, [path.resolve('scripts/init-db.js'), path.resolve('prisma/schema.prisma')], { env: process.env, stdio: 'pipe' })
  db = (await import('../src/lib/db')).prisma
  store = await import('../src/lib/ping-events')
})

after(async () => {
  await db?.$disconnect()
  if (directory && path.basename(directory).startsWith('tms-ping-events-')) await rm(directory, { recursive: true, force: true })
})

test('events are stored once, bound to the facility and attached to its open alarm', async () => {
  const system = await db.system.create({
    data: {
      name: '1레이더 네트워크', type: 'equipment', port: 6101, protocol: 'udp', status: 'critical',
      config: JSON.stringify({ normalPatterns: ['PING_OK'], criticalPatterns: ['PING_FAIL'], matchMode: 'exact', client: { id: 'ping-1', ip: '127.0.0.1', kind: 'ping', discoveryPort: 7791 } }),
    },
  })
  const alarm = await db.alarm.create({ data: { systemId: system.id, severity: 'critical', message: '1레이더 네트워크 심각 상태 (PING_FAIL)' } })
  await db.alarmLog.create({ data: { systemId: system.id, systemName: system.name, severity: 'critical', message: alarm.message } })

  const report = store.parsePingEventReport({
    id: 'ping-1', name: '1레이더 네트워크', host: 'RADAR1',
    events: [{ at: Date.now() - 5000, name: '1레이더 스위치', address: '192.168.0.5', status: '장애 발생', sent: 3, lost: 3, consecutiveFailures: 3 }],
  })!
  const first = await store.storePingEvents(report)
  assert.equal(first.system?.id, system.id)
  assert.equal(first.inserted, 1)
  assert.equal(first.newestFailure?.address, '192.168.0.5')
  // The client re-sends its backlog after a reconnect: nothing is duplicated.
  const again = await store.storePingEvents(report)
  assert.equal(again.inserted, 0)
  assert.equal((await store.listPingEvents(system.id)).length, 1)

  const summary = await store.currentFailureSummary(system.id)
  assert.equal(summary, '1레이더 스위치 192.168.0.5 응답 없음 (3회 연속)')
  assert.equal(await store.attachFailureSummaryToAlarm(system.id, summary!), alarm.id)
  assert.equal((await db.alarm.findUnique({ where: { id: alarm.id } }))?.value, summary)
  assert.equal((await db.alarmLog.findFirst({ where: { systemId: system.id } }))?.value, summary)

  // After the recovery event nothing is failed any more.
  const recovery = store.parsePingEventReport({
    id: 'ping-1', name: '1레이더 네트워크', host: 'RADAR1',
    events: [{ at: Date.now(), name: '1레이더 스위치', address: '192.168.0.5', status: '정상 복구', rttMs: 1, sent: 4, lost: 3, consecutiveFailures: 0 }],
  })!
  await store.storePingEvents(recovery)
  assert.equal(await store.currentFailureSummary(system.id), null)

  // Unknown clients are stored without a facility and never touch alarms.
  const orphan = await store.storePingEvents({ clientId: 'nobody', clientName: '', host: '', events: report.events })
  assert.equal(orphan.system, null)
  assert.equal(await store.findSystemForClient('nobody'), null)
})
