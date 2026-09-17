import assert from 'node:assert/strict'
import { test } from 'node:test'
import dgram from 'node:dgram'
import { CLIENT_DISCOVERY_PORTS, UPS_CLIENT_DISCOVERY_PORT, discoverClients, parseHereReply } from '../src/lib/client-discovery'
import { CLIENT_KIND_PORTS, clientKindName, clientKindOf, discoveryPortFor, upsUnitLabel } from '../src/lib/client-kinds'
import { validateSystemBody } from '../src/lib/system-validation'
import { minTransferVersion, supportsTransfer } from '../src/lib/transfer-rules'
import { buildUpsClientCustomCode, buildUpsClientDisplayItems, buildUpsClientPreset, isUpsClientPreset, UPS_CLIENT_ITEMS } from '../src/lib/ups-client-preset'
import { compileCustomCode, executeScript } from '../src/lib/custom-code-script'
import { alarmDetailsBySystem, isPingClientSystem } from '../src/lib/alarm-details'

test('the ups client is a third discovery kind on UDP 7792', () => {
  assert.deepEqual(CLIENT_DISCOVERY_PORTS, [7790, 7791, 7792])
  assert.equal(UPS_CLIENT_DISCOVERY_PORT, 7792)
  assert.equal(CLIENT_KIND_PORTS.ups, 7792)
  assert.equal(clientKindOf('ups'), 'ups')
  assert.equal(clientKindOf('anything else'), 'sound')
  assert.equal(discoveryPortFor('ups'), 7792)
  assert.equal(discoveryPortFor(undefined), 7790)
  assert.equal(clientKindName('ups'), '2026 1레이더 UPS')
  assert.equal(upsUnitLabel(2), 'UPS#2')
  assert.equal(upsUnitLabel(undefined), 'UPS#1')
})

test('a ups here reply carries both units', () => {
  const here = {
    v: 1, t: 'here', nonce: 'abc', kind: 'ups', discoveryPort: 7792, id: 'ups-1', name: '1레이더 UPS PC', host: 'UPS-PC', ver: '1.0.0',
    target: null, muted: false, sound: false, alarm: null, running: true, uptimeSec: 9,
    units: [
      { unit: 1, target: null, alarm: null, reachable: null },
      { unit: 2, target: { ip: '10.0.0.1', port: 6102 }, alarm: false },
      { bogus: true },
    ],
  }
  const parsed = parseHereReply(JSON.stringify(here), 'abc', '10.0.0.9', '10.0.0.1')
  assert.ok(parsed)
  assert.equal(parsed.kind, 'ups')
  assert.equal(parsed.discoveryPort, 7792)
  assert.deepEqual(parsed.units, [
    { unit: 1, target: null, alarm: null },
    { unit: 2, target: { ip: '10.0.0.1', port: 6102 }, alarm: false },
  ])
  const sound = parseHereReply(JSON.stringify({ ...here, kind: undefined, units: undefined }), 'abc', '10.0.0.9', '10.0.0.1')
  assert.equal(sound?.kind, 'sound')
  assert.equal(sound?.units, undefined)
})

test('a fake ups client is discovered next to the other kinds', async () => {
  const socket = dgram.createSocket('udp4')
  socket.on('message', (raw, rinfo) => {
    const message = JSON.parse(raw.toString())
    if (message.t !== 'probe') return
    const reply = { v: 1, t: 'here', nonce: message.nonce, id: 'ups', kind: 'ups', name: 'UPS PC', host: 'UPS', ver: '1.0.0', mac: '', target: null, muted: false, sound: false, alarm: true, running: true, uptimeSec: 1, units: [{ unit: 1, target: null, alarm: true }, { unit: 2, target: null, alarm: null }] }
    socket.send(Buffer.from(JSON.stringify(reply)), rinfo.port, rinfo.address)
  })
  const port = await new Promise<number>(resolve => socket.bind(0, '127.0.0.1', () => resolve(socket.address().port)))
  try {
    const clients = await discoverClients({ ports: [port], timeoutMs: 200, targets: [{ address: '127.0.0.1', broadcast: '127.0.0.1', netmask: '255.0.0.0' }] })
    assert.equal(clients.length, 1)
    assert.equal(clients[0].kind, 'ups')
    assert.equal(clients[0].discoveryPort, 7792)
    assert.equal(clients[0].units?.length, 2)
    assert.equal(clients[0].units?.[0].alarm, true)
  } finally { socket.close() }
})

test('facility config validates the ups client kind, port and unit', () => {
  const base = { delimiter: ',', displayItems: [] }
  const client = { id: 'ups', ip: '127.0.0.1', kind: 'ups', discoveryPort: 7792, unit: 2 }
  assert.equal(validateSystemBody({ config: { ...base, client } }, true), null)
  assert.ok(validateSystemBody({ config: { ...base, client: { ...client, unit: 3 } } }, true))
  assert.ok(validateSystemBody({ config: { ...base, client: { ...client, unit: undefined } } }, true))
  assert.ok(validateSystemBody({ config: { ...base, client: { ...client, discoveryPort: 7791 } } }, true))
  assert.ok(validateSystemBody({ config: { ...base, client: { ...client, kind: 'toaster' } } }, true))
  assert.ok(validateSystemBody({ config: { ...base, client: { id: 'p', ip: '127.0.0.1', kind: 'ping', discoveryPort: 7791, unit: 1 } } }, true), 'unit only for ups')
})

test('file transfer is offered to ups clients from 1.0.0', () => {
  assert.equal(minTransferVersion('ups'), '1.0.0')
  assert.ok(supportsTransfer('1.0.0', 'ups'))
  assert.ok(supportsTransfer('1.3.0', 'ups'))
  assert.ok(!supportsTransfer('0.9.0', 'ups'))
  assert.ok(!supportsTransfer('1.0.0', 'ping'), 'ping still needs 1.1.0')
})

test('ups preset display items mirror the client parameters and limits', () => {
  const ups1 = buildUpsClientDisplayItems(1)
  const ups2 = buildUpsClientDisplayItems(2)
  assert.equal(ups1.length, UPS_CLIENT_ITEMS[1].length)
  assert.equal(ups1.length, 24)
  assert.equal(ups2.length, 9)
  assert.equal(new Set(ups1.map(i => i.name)).size, ups1.length, 'unique names')
  const inputR = ups1.find(i => i.name === '입력전압 R')!
  assert.equal(inputR.warning, 300)
  assert.equal(inputR.critical, 700)
  assert.equal(inputR.itemType, 'inputVoltage')
  const currentR = ups1.find(i => i.name === '입력전류 R')!
  assert.equal(currentR.warning, null, 'a 0 lower bound must not alarm at idle')
  assert.equal(currentR.critical, 50)
  const status = ups1.find(i => i.name === '출력상태')!
  assert.equal(status.itemType, 'status')
  assert.equal(status.warning, null)
  assert.deepEqual(status.conditions?.critical, [{ operator: 'neq', value1: 0, value2: null, stringValue: '정상' }])
  assert.equal(ups2.find(i => i.name === '배터리온도')?.critical, 60)
  assert.equal(validateSystemBody({ config: buildUpsClientPreset(1) }, true), null)
  assert.equal(validateSystemBody({ config: buildUpsClientPreset(2) }, true), null)
  assert.ok(isUpsClientPreset(buildUpsClientPreset(2), 2))
  assert.ok(!isUpsClientPreset(buildUpsClientPreset(2), 1))
})

test('the generated parser turns the client datagram into metric values', () => {
  const script = compileCustomCode(buildUpsClientCustomCode(2))
  const datagram = JSON.stringify({ UPS: 2, Data: {
    '출력 상태': '정상', '입력 전압 (V)': '220 V', '출력 전압 (V)': '221 V', '입력 주파수 (Hz)': '60.0 Hz', '출력 주파수 (Hz)': '59.9 Hz',
    '배터리 상태': '배터리 부족', '배터리 전압 (V)': '13.50 V', '배터리 잔량 (%)': 'No Data', '배터리 온도 (°C)': '28°C',
  } })
  const result = executeScript(script, datagram, 500)
  assert.deepEqual(result, {
    '입력전압': 220, '출력전압': 221, '입력주파수': 60, '출력주파수': 59.9, '배터리전압': 13.5, '배터리온도': 28,
    '출력상태': '정상', '배터리상태': '배터리 부족',
  })
  assert.deepEqual(executeScript(script, JSON.stringify({ UPS: 1, Data: { '출력 상태': '정상' } }), 500), {}, 'other unit ignored')
  assert.throws(() => executeScript(script, 'not json', 500))
  const ups1 = compileCustomCode(buildUpsClientCustomCode(1))
  const three = executeScript(ups1, JSON.stringify({ UPS: 1, Data: { '입력 전압 R (V)': '374 V', '출력 R (%)': '45.0 %', '입력 전력 T (kW)': '12.3 kW', '배터리 상태': '정상' } }), 500)
  assert.deepEqual(three, { '입력전압 R': 374, '부하 R': 45, '입력전력 T': 12.3, '배터리상태': '정상' })
})

test('dashboard detail text comes from open alarms of ping-client facilities only', () => {
  const ping = { id: 'p', config: JSON.stringify({ normalPatterns: ['PING_OK'], criticalPatterns: ['PING_FAIL'], client: { id: 'c', ip: '1.1.1.1', kind: 'ping' } }) }
  const sound = { id: 's', config: JSON.stringify({ normalPatterns: ['SILENCE'], criticalPatterns: ['SOUND'], client: { id: 'd', ip: '1.1.1.2', kind: 'sound' } }) }
  const plain = { id: 'x', config: null }
  assert.ok(isPingClientSystem(ping.config))
  assert.ok(!isPingClientSystem(sound.config))
  assert.ok(!isPingClientSystem('{broken'))
  const alarms = [
    { systemId: 'p', severity: 'warning', value: '이전 값', resolvedAt: null },
    { systemId: 'p', severity: 'critical', value: '1레이더 스위치 192.168.0.5 응답 없음 (3회 연속)', resolvedAt: null },
    { systemId: 'p', severity: 'critical', value: '해결됨', resolvedAt: new Date() },
    { systemId: 's', severity: 'critical', value: 'SOUND', resolvedAt: null },
    { systemId: 'x', severity: 'critical', value: 'raw', resolvedAt: null },
  ]
  const details = alarmDetailsBySystem([ping, sound, plain], alarms)
  assert.deepEqual([...details.entries()], [['p', '1레이더 스위치 192.168.0.5 응답 없음 (3회 연속)']])
  assert.equal(alarmDetailsBySystem([sound], alarms).size, 0)
  assert.equal(alarmDetailsBySystem([ping], [{ systemId: 'p', severity: 'critical', value: '  ', resolvedAt: null }]).size, 0)
})
