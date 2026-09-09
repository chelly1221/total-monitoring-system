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
    return calls <= 6 ? new Response('Bad Gateway', { status: 502 }) : Response.json(body())
  })
  await assert.rejects(fetchAmoLightning(), /HTTP 502/)
  await assert.rejects(fetchAmoLightning(), /HTTP 502/)
  assert.equal(calls, 6)
  clock += 60_000
  assert.deepEqual((await fetchAmoLightning()).strikes, [])
  assert.equal(calls, 7)
})

test('network timeouts and connection failures have Korean diagnostics and retain their cause', async t => {
  let clock = now + 120_000
  t.mock.method(Date, 'now', () => clock)
  const failures = [
    [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), /응답 시간 초과/],
    [new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), /응답 시간 초과/],
    [new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), /서버 연결 실패/],
  ] as const
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { throw failures[Math.floor(calls++ / 6)][0] })
  for (const [cause, message] of failures) {
    await assert.rejects(fetchAmoLightning(), error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, message)
      assert.equal(error.cause, cause)
      return true
    })
    clock += 60_000
  }
  assert.equal(calls, failures.length * 6)
})

test('transient server failures share one immediate retry and release failed response bodies', async t => {
  let clock = now + 5 * 60_000
  t.mock.method(Date, 'now', () => clock)
  for (const status of [500, 502, 503, 504]) {
    await t.test(`HTTP ${status}`, async sub => {
      let calls = 0
      let cancelled = false
      const signals: (AbortSignal | null | undefined)[] = []
      sub.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
        signals.push(init?.signal)
        if (++calls === 1) return new Response(new ReadableStream({ cancel() { cancelled = true } }), { status })
        assert.ok(cancelled, 'The error response must be released before retrying')
        return Response.json(body())
      })
      const pending = fetchAmoLightning()
      assert.equal(fetchAmoLightning(), pending)
      const result = await pending
      assert.deepEqual(result.strikes, [])
      assert.equal(calls, 2, 'The retry happens without advancing the clock')
      assert.ok(signals[0])
      assert.ok(signals[1])
      assert.notEqual(signals[0], signals[1])
      assert.equal(await fetchAmoLightning(), result)
      assert.equal(calls, 2)
    })
    clock += 60_000
  }
})

test('timeouts get fresh deadlines and can recover on the fifth immediate retry', async t => {
  const clock = now + 9 * 60_000
  t.mock.method(Date, 'now', () => clock)
  const signals = [
    ...Array.from({ length: 5 }, () => AbortSignal.abort(new DOMException('Timeout', 'TimeoutError'))),
    new AbortController().signal,
  ]
  let deadlines = 0
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 15_000)
    return signals[deadlines++]
  })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    calls++
    init?.signal?.throwIfAborted()
    return Response.json(body())
  })
  assert.deepEqual((await fetchAmoLightning()).strikes, [])
  assert.equal(calls, 6)
  assert.equal(deadlines, 6)
})

test('client errors, requested backoff and invalid data do not trigger immediate retries', async t => {
  let clock = now + 10 * 60_000
  t.mock.method(Date, 'now', () => clock)
  const cases = [
    { name: 'forbidden', response: () => new Response('', { status: 403 }), error: /HTTP 403/ },
    { name: 'rate limit', response: () => new Response('', { status: 429 }), error: /HTTP 429/ },
    { name: 'server backoff', response: () => new Response('', { status: 503, headers: { 'Retry-After': '60' } }), error: /HTTP 503/ },
    { name: 'invalid JSON', response: () => new Response('<html>error</html>'), error: SyntaxError },
    { name: 'invalid schema', response: () => Response.json({}), error: /응답 형식 오류/ },
    { name: 'stale data', response: () => Response.json(body([], ['2026-09-08T05:00:00'])), error: /갱신 지연/ },
  ]
  for (const scenario of cases) {
    await t.test(scenario.name, async sub => {
      let calls = 0
      sub.mock.method(globalThis, 'fetch', async () => { calls++; return scenario.response() })
      await assert.rejects(fetchAmoLightning(), scenario.error)
      await assert.rejects(fetchAmoLightning(), scenario.error)
      assert.equal(calls, 1)
    })
    clock += 60_000
  }
})

test('mixed failures share one five-retry budget beyond 60 seconds and cool down after completion', async t => {
  let clock = now + 16 * 60_000
  t.mock.method(Date, 'now', () => clock)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls > 6) return Response.json(body())
    clock += 15_000
    if (calls >= 5) assert.equal(fetchAmoLightning(), pending, 'An active retry sequence must still be shared after 60 seconds')
    if (calls % 2 === 0) throw new DOMException('Timeout', 'TimeoutError')
    return new Response('Bad Gateway', { status: 502 })
  })
  const pending = fetchAmoLightning()
  await assert.rejects(pending, /응답 시간 초과/)
  assert.equal(calls, 6, 'The initial attempt plus five retries exhausts the shared budget')
  assert.equal(clock, now + 17.5 * 60_000)
  assert.equal(fetchAmoLightning(), pending)
  clock += 59_999
  assert.equal(fetchAmoLightning(), pending, 'Cooldown is measured from the final failure')
  assert.equal(calls, 6)
  clock++
  assert.deepEqual((await fetchAmoLightning()).strikes, [])
  assert.equal(calls, 7)
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
