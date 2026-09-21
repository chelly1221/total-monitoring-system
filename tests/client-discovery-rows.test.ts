import assert from 'node:assert/strict'
import test from 'node:test'
import { clientDiscoveryRows } from '../src/lib/client-discovery-rows'
import type { DiscoveredClient } from '../src/types'

const client = (id: string, extra: Partial<DiscoveredClient> = {}): DiscoveredClient => ({
  id, name: id, host: id, ip: '192.0.2.10', serverIp: '192.0.2.1', mac: '', ver: '1',
  target: null, muted: false, sound: false, uptimeSec: 0, registered: null, ...extra,
})

test('discovery lists unregistered facilities first without mutating scan order', () => {
  const clients = [client('registered', { registered: { systemId: 's', systemName: '시설' } }),
    client('free-b'), client('free-a')]
  assert.deepEqual(clientDiscoveryRows(clients).map(row => row.key), ['free-b', 'free-a', 'registered'])
  assert.deepEqual(clients.map(item => item.id), ['registered', 'free-b', 'free-a'])
})

test('partially registered UPS lists its free card before its registered card', () => {
  const ups = client('ups', { kind: 'ups', registeredUnits: [{ unit: 1, systemId: 's', systemName: 'UPS 시설' }] })
  const rows = clientDiscoveryRows([ups])
  assert.deepEqual(rows.map(row => row.unit), [2, 1])
  assert.equal(rows[0].registration, null)
  assert.equal(rows[1].registration?.systemId, 's')
  assert.equal(rows[0].client, ups)
})

test('discovery only offers unique reported UPS cards, falling back for old clients', () => {
  const rows = clientDiscoveryRows([client('ups', { kind: 'ups', units: [
    { unit: 2, target: null, alarm: false }, { unit: 2, target: null, alarm: false },
    { unit: 9, target: null, alarm: false },
  ] })])
  assert.deepEqual(rows.map(row => row.unit), [2])
  assert.deepEqual(clientDiscoveryRows([client('old', { kind: 'ups', units: [] })]).map(row => row.unit), [1, 2])
})
