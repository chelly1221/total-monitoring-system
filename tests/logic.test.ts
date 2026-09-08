import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runCustomCode } from '../src/lib/custom-code-executor'
import { executeCustomCode } from '../src/worker/custom-code-executor'
import { evaluateDisplayItemStatus } from '../src/lib/threshold-evaluator'
import { parsePort, validateSystemBody } from '../src/lib/system-validation'
import { buildWing15State, fetchNearbyStrikes, mergeStrikes, parseStrikes } from '../src/lib/wing15'
import { extractNumericValue } from '../src/worker/parser'
import { validateSirenBody } from '../src/lib/siren-validation'
import type { DisplayItem } from '../src/types'

test('ports reject truncation, decimals, booleans and out-of-range values', () => {
  for (const input of [0, -1, 65536, 12.5, '7777oops', '5e3', '', true, {}, null]) assert.equal(parsePort(input), null)
  for (const input of [1, 65535, ' 1884 ']) assert.equal(parsePort(input), Number(input))
})

test('partial edits validate parser syntax and duplicate metric names', () => {
  assert.ok(validateSystemBody({ config: { customCode: 'return {' } }, true))
  const item = { name: '온도', unit: '°C', index: 0 }
  assert.ok(validateSystemBody({ config: { displayItems: [item, item] } }, true))
  assert.ok(validateSystemBody(null))
})

test('siren partial edits validate IP, protocol, port and enabled state', () => {
  for (const body of [{ ip: 'not-an-ip' }, { port: '12junk' }, { protocol: 'http' }, { isEnabled: 'false' }]) {
    assert.ok(validateSirenBody(body, true))
  }
  assert.equal(validateSirenBody({ isEnabled: false }, true), null)
})

test('disabled, textual, empty-condition and legacy thresholds agree', () => {
  const item: DisplayItem = { name: '상태', index: 0, unit: '', warning: 10, critical: 30 }
  assert.equal(evaluateDisplayItemStatus({ value: 5 }, item), 'critical')
  assert.equal(evaluateDisplayItemStatus({ value: 35 }, { ...item, alarmEnabled: false }), 'normal')
  item.conditions = { normal: [], critical: [], coldCritical: [], dryCritical: [], humidCritical: [] }
  assert.equal(evaluateDisplayItemStatus({ value: 35 }, item), 'critical')
  item.conditions.critical.push({ operator: 'neq', value1: 0, value2: null, stringValue: 'ONLINE' })
  assert.equal(evaluateDisplayItemStatus({ value: 0, textValue: 'ONLINE' }, item), 'normal')
  assert.equal(evaluateDisplayItemStatus({ value: 0, textValue: 'ONBATT' }, item), 'critical')
})

test('custom parser API and worker agree on empty, text and finite numeric results', () => {
  for (const code of ['return {}', 'return { voltage: 220, status: "ONLINE" }']) {
    const api = runCustomCode(code, '')
    assert.equal(api.success, true)
    assert.deepEqual(api.result, executeCustomCode('logic', code, ''))
  }
  for (const code of ['return { value: Infinity }', 'return { value: NaN }', 'return []']) {
    assert.equal(runCustomCode(code, '').success, false)
    assert.equal(executeCustomCode('logic', code, ''), null)
  }
  assert.deepEqual(runCustomCode('return { value: Number(raw) } // final comment', '42').result, { value: 42 })
})

test('getter and proxy loops are contained by the custom parser timeout', { timeout: 2000 }, () => {
  for (const code of [
    'return { get value() { while (true) {} } }',
    'return new Proxy({}, { ownKeys() { while (true) {} } })',
    'while (true) {}',
  ]) {
    const result = runCustomCode(code, '', 25)
    assert.equal(result.success, false)
    assert.match(result.error!, /timed out/)
  }
})

test('non-finite numeric packets cannot reach SQLite', () => {
  for (const value of ['Infinity', '1e999', '�22']) {
    assert.equal(extractNumericValue({ value, rawLength: value.length, timestamp: new Date() }), null)
  }
})

test('new strikes invalidate checked inspections while unchanged strikes preserve them', () => {
  const now = Date.UTC(2026, 8, 8)
  const strikes = [{ detectedAt: now - 2 * 3600_000, distanceKm: 2 }]
  const original = buildWing15State(strikes, null, null, now)
  const checklist = { sig: original.sig, special: true, maintenance: true }
  assert.deepEqual(buildWing15State(strikes, null, checklist, now).checklist, checklist)
  const next = buildWing15State([...strikes, { detectedAt: now - 1000, distanceKm: 1 }], null, checklist, now)
  assert.notEqual(next.sig, original.sig)
  assert.equal(next.checklist.special, false)
  assert.equal(next.items[0].active, true)
  assert.equal(buildWing15State(strikes, now, checklist, now).items.length, 0)
})

test('lightning history rejects malformed, future and out-of-radius rows', () => {
  const now = Date.now()
  assert.deepEqual(parseStrikes('[null,{"detectedAt":1,"distanceKm":-1}]'), [])
  const valid = { detectedAt: now - 1000, distanceKm: 5 }
  assert.deepEqual(mergeStrikes([valid, valid, { detectedAt: now + 1000, distanceKm: 1 }], [
    { detectedAt: now - 25 * 3600_000, distanceKm: 1 }, { detectedAt: now, distanceKm: -1 },
  ], now), [valid])
})

test('rapid settings polls share a single feed request, filtering missing distances', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json([
      null,
      { airport_code: 'RKSS', type: 'G', distance_km: null, detected_at: new Date().toISOString() },
      { airport_code: 'RKSS', type: 'G', distance_km: 2, detected_at: new Date(Date.now() - 1000).toISOString() },
    ])
  })
  const results = await Promise.all([fetchNearbyStrikes(), fetchNearbyStrikes(), fetchNearbyStrikes()])
  assert.equal(calls, 1)
  assert.equal(results[0].length, 1)
  await fetchNearbyStrikes()
  assert.equal(calls, 1)
})
