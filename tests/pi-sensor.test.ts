import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import dgram from 'node:dgram'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { PI_CHANNELS, PI_DISCOVERY_PORT, parsePiChannels, piPreset } from '../src/lib/pi-sensor'
import { CLIENT_DISCOVERY_PORTS, discoverClients, parseHereReply, sendClientCommand } from '../src/lib/client-discovery'
import { markRegistrations } from '../src/lib/client-registrations'
import { validateSystemBody } from '../src/lib/system-validation'
import { supportsTransfer } from '../src/lib/transfer-rules'

const here = { v: 1, t: 'here', nonce: '0123456789abcdef', id: 'pi-test', kind: 'pi', name: '시험 장비', host: 'tms-pi', channels: [{ id: 'dht1' }, { id: 'door1' }] }
const device = parseHereReply(JSON.stringify(here), here.nonce, '192.168.1.50', '192.168.1.10')!

test('Pi discovery parses enabled channels separately from other clients', () => {
  assert.ok(CLIENT_DISCOVERY_PORTS.includes(PI_DISCOVERY_PORT))
  assert.equal(device.kind, 'pi')
  assert.equal(device.discoveryPort, 7793)
  assert.deepEqual(device.channels?.map(c => c.id), ['dht1', 'door1'])
  assert.deepEqual(parsePiChannels([{ id: 'other' }, { id: 'door1' }, { id: 'door1' }]).map(c => c.id), ['door1'])
  assert.equal(supportsTransfer('100.0.0', 'pi'), false)
  assert.equal(new Set(PI_CHANNELS.map(c => c.gpio)).size, 8)
  assert.equal(new Set(PI_CHANNELS.map(c => c.pin)).size, 8)
})

test('Pi presets work with existing metrics and equipment parsers', () => {
  const client = { kind: 'pi' as const, id: 'pi-test', name: '시험', host: 'pi', ip: '192.168.1.50', channel: 'dht1' as const }
  const config = piPreset('dht1', client)
  assert.ok('displayItems' in config)
  assert.deepEqual(config.displayItems.map(i => '24.5,63.2'.split(config.delimiter)[i.index]), ['24.5', '63.2'])
  assert.equal(validateSystemBody({ name: '센서', type: 'sensor', protocol: 'udp', port: 6300, config }), null)
  assert.ok(validateSystemBody({ config: { client: { ...client, channel: 'no' } } }, true))
  const door = piPreset('door1', { ...client, channel: 'door1' })
  assert.ok('normalPatterns' in door)
  assert.deepEqual(door.normalPatterns, ['CLOSED'])
  assert.deepEqual(door.criticalPatterns, ['OPEN'])
})

test('Pi probe and config ACK travel through real UDP sockets', async () => {
  const socket = dgram.createSocket('udp4')
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  socket.on('message', (raw, source) => {
    const message = JSON.parse(raw.toString())
    const reply = message.t === 'probe' ? { ...here, nonce: message.nonce } : { v: 1, t: 'ack', id: here.id, nonce: message.nonce, ok: message.channel === 'door1' }
    socket.send(JSON.stringify(reply), source.port, source.address)
  })
  try {
    const replies = await discoverClients({ port, timeoutMs: 80, targets: [{ address: '127.0.0.1', broadcast: '127.0.0.1', netmask: '255.0.0.0' }] })
    assert.equal(replies[0].kind, 'pi')
    assert.equal((await sendClientCommand('127.0.0.1', 'config', { channel: 'door1' }, { port, timeoutMs: 100 })).id, here.id)
    await assert.rejects(sendClientCommand('127.0.0.1', 'config', { channel: 'bad' }, { port, timeoutMs: 100 }), /거부/)
  } finally { socket.close() }
})

let directory: string
let db: typeof import('../src/lib/db').prisma
let register: typeof import('../src/lib/pi-registration').registerPiChannel
before(async () => {
  process.env.WS_PORT = '17798'
  directory = await mkdtemp(path.join(tmpdir(), 'tms-pi-test-'))
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replaceAll('\\', '/')}`
  execFileSync(process.execPath, [path.resolve('scripts/init-db.js'), path.resolve('prisma/schema.prisma')], { env: process.env, stdio: 'pipe' })
  db = (await import('../src/lib/db')).prisma
  register = (await import('../src/lib/pi-registration')).registerPiChannel
})
after(async () => {
  await db?.$disconnect()
  if (directory && path.basename(directory).startsWith('tms-pi-test-')) await rm(directory, { recursive: true, force: true })
})

test('channel registration is idempotent, allocates separate ports and preserves thresholds', async () => {
  const sensor = await register(db, device, 'dht1', '온습도')
  const config = JSON.parse(sensor.config!)
  config.displayItems[0].critical = 35
  await db.system.update({ where: { id: sensor.id }, data: { config: JSON.stringify(config), name: '수정한 이름' } })
  const retry = await register(db, device, 'dht1', '다시 등록')
  assert.equal(retry.id, sensor.id)
  assert.equal(retry.name, '수정한 이름')
  assert.equal(JSON.parse(retry.config!).displayItems[0].critical, 35)
  const door = await register(db, device, 'door1', '출입문')
  assert.notEqual(sensor.port, door.port)
  assert.equal(door.type, 'equipment')
  assert.equal((await db.metric.findMany({ where: { systemId: sensor.id } })).length, 2)
  const marked = markRegistrations([device], await db.system.findMany())[0]
  assert.equal(marked.registered, null)
  assert.deepEqual(marked.registeredChannels?.map(c => c.channel), ['dht1', 'door1'])
})

test('Pi measurements and door transitions reach the existing worker alarms', async () => {
  const worker = await import('../src/worker/db-updater')
  try {
    const sensor = await register(db, { ...device, id: 'worker-pi' }, 'dht1', '실측 시험')
    const door = await register(db, { ...device, id: 'worker-pi' }, 'door1', '개폐 시험')
    const ingest = async (system: typeof sensor, value: string) => worker.updateMetric(
      { system: system.name, type: system.type as 'sensor' | 'equipment', encoding: 'utf8' },
      { value: JSON.stringify({ v: 1, t: 'sensor', id: 'worker-pi', channel: JSON.parse(system.config!).client.channel, value }), rawLength: value.length, timestamp: new Date() }, system.port!, 'udp',
    )
    await ingest(sensor, '24.5,63.2')
    const metrics = await db.metric.findMany({ where: { systemId: sensor.id } })
    assert.equal(metrics.find(m => m.name === '온도')?.value, 24.5)
    assert.equal(metrics.find(m => m.name === '습도')?.value, 63.2)
    const last = (await db.system.findUniqueOrThrow({ where: { id: sensor.id } })).lastDataAt
    await worker.updateMetric({ system: sensor.name, type: 'sensor', encoding: 'utf8' },
      { value: JSON.stringify({ v: 1, t: 'sensor', id: 'deleted-pi', channel: 'dht1', value: '80,100' }), rawLength: 100, timestamp: new Date() }, sensor.port!, 'udp')
    assert.equal((await db.system.findUniqueOrThrow({ where: { id: sensor.id } })).lastDataAt?.getTime(), last?.getTime())
    assert.equal((await db.metric.findFirstOrThrow({ where: { systemId: sensor.id, name: '온도' } })).value, 24.5)
    await ingest(door, 'CLOSED')
    assert.equal((await db.system.findUnique({ where: { id: door.id } }))?.status, 'normal')
    await ingest(door, 'OPEN')
    assert.equal((await db.system.findUnique({ where: { id: door.id } }))?.status, 'critical')
    assert.equal(await db.alarm.count({ where: { systemId: door.id, resolvedAt: null } }), 1)
    await ingest(door, 'CLOSED')
    assert.equal((await db.system.findUnique({ where: { id: door.id } }))?.status, 'normal')
    assert.equal(await db.alarm.count({ where: { systemId: door.id, resolvedAt: null } }), 0)
  } finally { await worker.closeDatabase() }
})

test('native Pi dashboard exposes every alarm type and persists Korean names', async () => {
  const { GET, POST } = await import('../src/app/api/pi/dashboard/route')
  await db.setting.upsert({ where: { key: 'wing15Enabled' }, create: { key: 'wing15Enabled', value: 'false' }, update: { value: 'false' } })
  const sensor = await register(db, { ...device, id: 'dashboard-pi' }, 'dht1', '화면 시험')
  for (const type of ['radar', 'ups', 'ping', 'sound', 'sensor', 'equipment']) {
    const system = await db.system.create({ data: { name: `종류 ${type}`, type, protocol: 'udp' } })
    await db.alarm.create({ data: { systemId: system.id, message: `${type} 시험`, severity: 'critical' } })
  }
  const result = await GET(new Request('http://localhost/api/pi/dashboard?id=dashboard-pi'))
  assert.equal(result.status, 200)
  const payload = await result.json()
  assert.equal(payload.channels.length, 1)
  for (const kind of ['radar', 'ups', 'ping', 'sound', 'sensor', 'equipment']) assert.ok(payload.alarms.some((a: { kind: string }) => a.kind === kind))
  const rename = await POST(new Request('http://localhost/api/pi/dashboard', { method: 'POST', body: JSON.stringify({ id: 'dashboard-pi', channel: 'dht1', name: '장비실 온습도 A' }) }))
  assert.equal(rename.status, 200)
  assert.equal((await db.system.findUniqueOrThrow({ where: { id: sensor.id } })).name, '장비실 온습도 A')
  assert.equal((await GET(new Request('http://localhost/api/pi/dashboard?id=unknown'))).status, 404)
  assert.equal((await POST(new Request('http://localhost/api/pi/dashboard', { method: 'POST', body: '{' }))).status, 400)
})
