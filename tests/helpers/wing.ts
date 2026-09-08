import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { NearbyStrike } from '../../src/lib/lightning-rules'

export function wingEvent(strike: NearbyStrike, number: number, overrides = {}) {
  return { id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`, lightning_info: {
    airport_code: 'RKSS', detectedAt: new Date(strike.detectedAt).toISOString(), type: 'G',
    distance_km: Number(strike.distanceKm.toFixed(1)), lat: strike.lat, lon: strike.lon, ...overrides,
  } }
}

export function mockWing(t: TestContext, events: ReturnType<typeof wingEvent>[]) {
  const state = {
    events, eventReads: 0, writes: [] as { method: string; body: unknown }[], persistWrites: true,
    inspections: new Map<string, { id: string; event_id: string; is_inspected: boolean }>(),
    onWrite: undefined as (() => Promise<void>) | undefined,
  }
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'bwckbsugyojylfyqivrj.supabase.co', 'Tests must not contact an unmocked service')
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: 'test-token', user: { id: 'test-tx' } })
    if (url.pathname === '/rest/v1/events') {
      state.eventReads++
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Number(url.searchParams.get('limit') || 1000)
      return Response.json(state.events.slice(offset, offset + limit))
    }
    assert.equal(url.pathname, '/rest/v1/inspection_status')
    if (!init?.method || init.method === 'GET') {
      const ids = (url.searchParams.get('event_id') || '').slice(4, -1).split(',')
      return Response.json([...state.inspections.values()].filter(row => ids.includes(row.event_id)))
    }
    const body = JSON.parse(String(init.body))
    state.writes.push({ method: init.method, body })
    if (state.persistWrites) {
      if (init.method === 'POST') {
        for (const row of body) {
          assert.equal(row.user_id, 'test-tx')
          state.inspections.set(row.event_id, { ...row, id: 'inspection-' + row.event_id })
        }
      } else {
        assert.equal(init.method, 'PATCH')
        const ids = (url.searchParams.get('id') || '').slice(4, -1).split(',')
        for (const row of state.inspections.values()) if (ids.includes(row.id)) row.is_inspected = body.is_inspected
      }
    }
    await state.onWrite?.()
    return new Response(null, { status: 204 })
  })
  return state
}
