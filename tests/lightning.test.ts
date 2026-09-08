import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AMO_MAX_DATA_AGE_MS, fetchAmoLightning, parseAmoLightning, parseWebUtc } from '../src/lib/amo-lightning'
import { GIMPO, distanceKm, type NearbyStrike } from '../src/lib/lightning-rules'
import { buildWing15State, confirmOnWing15, mergeStrikes, Wing15ConfirmationPendingError } from '../src/lib/wing15'
import { mockWing, wingEvent } from './helpers/wing'

const now = Date.UTC(2026, 8, 8, 6)
const row = (overrides = {}) => ({ date: '2026-09-08T05:50:00', type: '1', lat: GIMPO.lat, lon: GIMPO.lon, ...overrides })
const body = (lgtList: unknown[] = [], baseDateList: unknown[] = ['2026-09-08T06:00:00.123456']) => ({ baseDateList, lgtList })
const strike = (overrides = {}): NearbyStrike => ({ detectedAt: now - 2 * 3600_000, distanceKm: 0, lat: GIMPO.lat, lon: GIMPO.lon, confirmed: false, ...overrides })

test('public map UTC timestamps never depend on the PC timezone', () => {
  assert.equal(parseWebUtc('2026-09-08T05:50:00'), Date.UTC(2026, 8, 8, 5, 50))
  assert.equal(parseWebUtc('2026-09-08T14:50:00+09:00'), Date.UTC(2026, 8, 8, 5, 50))
  assert.equal(parseWebUtc('2026-09-08T05:50:00.123456'), Date.UTC(2026, 8, 8, 5, 50, 0, 123))
  for (const invalid of ['2026-02-30T00:00:00', 'yesterday', null, 0]) assert.ok(Number.isNaN(parseWebUtc(invalid)))
})

test('uses WING Gimpo coordinates and filters at 5km before rounding, ground only', () => {
  assert.deepEqual(GIMPO, { code: 'RKSS', lat: 37.56, lon: 126.8 })
  const latitudeAt = (km: number) => GIMPO.lat + km / 6371 * 180 / Math.PI
  const result = parseAmoLightning(body([
    row(), row({ lat: latitudeAt(4.999) }), row({ lat: latitudeAt(5.001) }),
    row({ type: '2' }), row({ type: 2 }), row({ type: 1 }),
    row({ lat: 37.46, lon: 126.44 }), // Incheon airport
  ]), now + 1000)
  assert.equal(result.strikes.length, 2)
  assert.equal(result.strikes[0].confirmed, false)
  assert.ok(result.strikes.some(item => Math.abs(item.distanceKm - 4.999) < 0.0001))
  assert.ok(Math.abs(distanceKm(latitudeAt(5), GIMPO.lon) - 5) < 0.0000001)
})

test('malformed or stale web data is an error, a valid empty list means no strikes', () => {
  assert.deepEqual(parseAmoLightning(body(), now + 1000).strikes, [])
  for (const value of [null, {}, body([], []), body([], ['bad']), body([null]), body([row({ type: 'unknown' })]),
    body([row({ lat: null })]), body([row({ lon: 181 })]), body([row({ date: '2026-02-30T01:00:00' })])]) {
    assert.throws(() => parseAmoLightning(value, now + 1000))
  }
  assert.throws(() => parseAmoLightning(body(), now + AMO_MAX_DATA_AGE_MS + 1000), /갱신 지연/)
  assert.throws(() => parseAmoLightning(body(), now - 6 * 60_000), /갱신 지연/)
  assert.deepEqual(parseAmoLightning(body([row({ date: '2026-09-09T00:00:00' }), row({ date: '2026-09-06T00:00:00' })]), now + 1000).strikes, [])
})

test('web outages are shared during cooldown and can recover on the next attempt', async t => {
  let clock = now
  t.mock.method(Date, 'now', () => clock)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return calls === 1 ? new Response('Unavailable', { status: 503 }) : Response.json(body())
  })
  await assert.rejects(fetchAmoLightning(), /HTTP 503/)
  await assert.rejects(fetchAmoLightning(), /HTTP 503/)
  assert.equal(calls, 1)
  clock += 60_000
  assert.deepEqual((await fetchAmoLightning()).strikes, [])
  assert.equal(calls, 2)
})

test('legacy rounded rows migrate without duplicate alerts or losing confirmation', () => {
  const current = strike({ distanceKm: 1.234 })
  const legacy = { detectedAt: current.detectedAt, distanceKm: 1.2, confirmed: true }
  const merged = mergeStrikes([legacy], [current, current], now)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].confirmed, true)
  assert.equal(merged[0].lat, GIMPO.lat)
  const different = strike({ lat: GIMPO.lat + 0.0001, distanceKm: 1.234 })
  assert.equal(mergeStrikes([current], [different], now).length, 2)
})

test('late older arrivals are unconfirmed even below the old confirmation watermark', () => {
  const existing = strike({ confirmed: true })
  const late = strike({ detectedAt: existing.detectedAt - 60_000 })
  const state = buildWing15State([existing, late], now, null, now)
  assert.equal(state.items[0].confirmed, false)
  assert.ok(state.sig)
  assert.equal(state.items[0].active, false)
})

test('WING missing or partly received events block all inspection writes', async t => {
  const first = strike(), second = strike({ detectedAt: now - 3 * 3600_000 })
  const remote = mockWing(t, [wingEvent(first, 1)])
  await assert.rejects(confirmOnWing15([first, second], now), Wing15ConfirmationPendingError)
  assert.equal(remote.writes.length, 0)
  remote.events.length = 0
  await assert.rejects(confirmOnWing15([first], now), /WING에서 확인되지/)
  assert.equal(remote.writes.length, 0)
})

test('WING exact timestamps/locations match, foreign/cloud/outside/unreviewed events are excluded', async t => {
  const local = strike()
  const remote = mockWing(t, [
    wingEvent(local, 1), wingEvent(local, 2, { airport_code: 'RKSI' }), wingEvent(local, 3, { type: 'C' }),
    wingEvent(local, 4, { distance_km: 5.01 }), wingEvent(local, 5, { lat: GIMPO.lat + 0.01 }),
    wingEvent(strike({ detectedAt: now - 3600_000 }), 6),
  ])
  const result = await confirmOnWing15([local], now)
  assert.deepEqual(result, { total: 1, inserted: 1, updated: 0 })
  assert.deepEqual([...remote.inspections.keys()], [remote.events[0].id])
  const repeated = await confirmOnWing15([local], now)
  assert.deepEqual(repeated, { total: 1, inserted: 0, updated: 0 })
  assert.equal(remote.writes.length, 1)
})

test('successful HTTP without a saved WING inspection never reports confirmation success', async t => {
  const local = strike()
  const remote = mockWing(t, [wingEvent(local, 1)])
  remote.persistWrites = false
  await assert.rejects(confirmOnWing15([local], now), /저장되지/)
})

test('WING event pagination and existing inspection updates are verified', async t => {
  const reviewed = Array.from({ length: 205 }, (_, index) => strike({ detectedAt: now - 2 * 3600_000 - index * 1000 }))
  const remote = mockWing(t, reviewed.map((item, index) => wingEvent(item, index + 1)))
  const firstId = remote.events[0].id
  remote.inspections.set(firstId, { id: 'inspection-existing', event_id: firstId, is_inspected: false })
  const result = await confirmOnWing15(reviewed, now)
  assert.deepEqual(result, { total: 205, inserted: 204, updated: 1 })
  assert.equal(remote.eventReads, 2)
  assert.ok([...remote.inspections.values()].every(item => item.is_inspected))
})
