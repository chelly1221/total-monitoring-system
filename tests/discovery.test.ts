import assert from 'node:assert/strict'
import { test } from 'node:test'
import dgram from 'node:dgram'
import { createHmac } from 'node:crypto'
import {
  ClientCommandError,
  computeBroadcast,
  discoverClients,
  listBroadcastTargets,
  parseAck,
  parseHereReply,
  pickServerAddressFor,
  sameSubnet,
  sendClientCommand,
  signCommand,
  suggestSoundClientPort,
} from '../src/lib/client-discovery'
import { validateSystemBody } from '../src/lib/system-validation'

test('broadcast address, subnet membership and server address selection', () => {
  assert.equal(computeBroadcast('192.168.10.23', '255.255.255.0'), '192.168.10.255')
  assert.equal(computeBroadcast('10.1.2.3', '255.255.0.0'), '10.1.255.255')
  assert.equal(computeBroadcast('172.16.5.9', '255.255.255.128'), '172.16.5.127')
  assert.ok(sameSubnet('192.168.10.200', '192.168.10.23', '255.255.255.0'))
  assert.ok(!sameSubnet('192.168.11.1', '192.168.10.23', '255.255.255.0'))
  const targets = [
    { address: '10.0.0.5', netmask: '255.255.255.0', broadcast: '10.0.0.255' },
    { address: '192.168.1.5', netmask: '255.255.255.0', broadcast: '192.168.1.255' },
  ]
  assert.equal(pickServerAddressFor('192.168.1.77', targets), '192.168.1.5')
  assert.equal(pickServerAddressFor('8.8.8.8', targets), '10.0.0.5')
  assert.equal(pickServerAddressFor('8.8.8.8', []), null)
})

test('interface listing skips loopback, link-local and IPv6', () => {
  const targets = listBroadcastTargets({
    lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true, mac: '', cidr: null }],
    eth: [
      { address: '192.168.0.10', netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: '', cidr: null },
      { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false, mac: '', cidr: null, scopeid: 1 },
    ],
    dead: [{ address: '169.254.3.4', netmask: '255.255.0.0', family: 'IPv4', internal: false, mac: '', cidr: null }],
  })
  assert.deepEqual(targets, [{ address: '192.168.0.10', netmask: '255.255.255.0', broadcast: '192.168.0.255' }])
})

test('port suggestion skips default and registered ports', () => {
  assert.equal(suggestSoundClientPort([]), 6100)
  assert.equal(suggestSoundClientPort([6100, 6101, 1884]), 6102)
  const all = Array.from({ length: 100 }, (_, i) => 6100 + i)
  assert.equal(suggestSoundClientPort(all), null)
})

test('here and ack parsing enforce version, type and nonce', () => {
  const here = { v: 1, t: 'here', nonce: 'abc', id: 'c1', name: ' 1레이더 PC ', host: 'PC1', target: { ip: '10.0.0.1', port: 6100 }, muted: true }
  const parsed = parseHereReply(JSON.stringify(here), 'abc', '10.0.0.7', '10.0.0.1')
  assert.deepEqual(parsed, {
    id: 'c1', name: '1레이더 PC', host: 'PC1', ip: '10.0.0.7', serverIp: '10.0.0.1', mac: '', ver: '',
    target: { ip: '10.0.0.1', port: 6100 }, muted: true, sound: false, uptimeSec: 0,
  })
  assert.equal(parseHereReply(JSON.stringify({ ...here, nonce: 'zzz' }), 'abc', '10.0.0.7', '10.0.0.1'), null)
  assert.equal(parseHereReply(JSON.stringify({ ...here, v: 2 }), 'abc', '10.0.0.7', '10.0.0.1'), null)
  assert.equal(parseHereReply(JSON.stringify({ ...here, id: '' }), 'abc', '10.0.0.7', '10.0.0.1'), null)
  assert.equal(parseHereReply('not json', 'abc', '10.0.0.7', '10.0.0.1'), null)
  assert.deepEqual(parseAck(JSON.stringify({ v: 1, t: 'ack', nonce: 'n', ok: false, error: 'bad sig' }), 'n'),
    { ok: false, id: '', error: 'bad sig' })
  assert.equal(parseAck(JSON.stringify({ v: 1, t: 'ack', nonce: 'other', ok: true }), 'n'), null)
})

test('command signature matches HMAC-SHA256 over "t|nonce|ts"', () => {
  const expected = createHmac('sha256', 'secret').update('config|n1|1700000000').digest('hex')
  assert.equal(signCommand('secret', 'config', 'n1', 1700000000), expected)
})

test('facility config accepts a linked client and rejects malformed ones', () => {
  const base = { normalPatterns: ['SILENCE'], criticalPatterns: ['SOUND'], matchMode: 'exact' }
  assert.equal(validateSystemBody({ config: { ...base, client: { id: 'c1', ip: '10.0.0.7', name: 'PC', host: 'H' } } }, true), null)
  assert.ok(validateSystemBody({ config: { ...base, client: { ip: '10.0.0.7' } } }, true))
  assert.ok(validateSystemBody({ config: { ...base, client: 'c1' } }, true))
})

interface FakeClientOptions { token?: string; silent?: boolean }

/** Minimal in-process SoundSense client speaking the discovery protocol on loopback. */
function startFakeClient(options: FakeClientOptions = {}) {
  const socket = dgram.createSocket('udp4')
  const received: unknown[] = []
  socket.on('message', (raw, rinfo) => {
    const message = JSON.parse(raw.toString())
    received.push(message)
    if (options.silent) return
    const reply = (body: Record<string, unknown>) =>
      socket.send(Buffer.from(JSON.stringify({ v: 1, ...body })), rinfo.port, rinfo.address)
    if (message.t === 'probe') {
      reply({ t: 'here', nonce: message.nonce, id: 'fake-1', name: '테스트 PC', host: 'FAKE', ver: '3.0.0', mac: 'AA:BB', target: null, muted: false, sound: true, uptimeSec: 5 })
      return
    }
    if (message.t === 'identify' || message.t === 'config') {
      const token = options.token ?? ''
      const ok = !token || message.sig === signCommand(token, message.t, message.nonce, message.ts)
      reply({ t: 'ack', nonce: message.nonce, ok, id: 'fake-1', error: ok ? '' : 'invalid signature' })
    }
  })
  return new Promise<{ port: number; received: unknown[]; close: () => void }>(resolve => {
    socket.bind(0, '127.0.0.1', () => {
      resolve({ port: socket.address().port, received, close: () => socket.close() })
    })
  })
}

test('discovery collects loopback replies and dedupes by client id', async () => {
  const fake = await startFakeClient()
  try {
    const targets = [{ address: '127.0.0.1', netmask: '255.0.0.0', broadcast: '127.0.0.1' }]
    const clients = await discoverClients({ targets, port: fake.port, timeoutMs: 400 })
    assert.equal(clients.length, 1)
    assert.equal(clients[0].id, 'fake-1')
    assert.equal(clients[0].name, '테스트 PC')
    assert.equal(clients[0].ip, '127.0.0.1')
    assert.equal(clients[0].serverIp, '127.0.0.1')
    assert.equal(clients[0].sound, true)
    // Two probes are sent per scan; both were answered but only one client is reported.
    assert.ok(fake.received.filter(m => (m as { t: string }).t === 'probe').length >= 1)
  } finally {
    fake.close()
  }
})

test('commands are signed when a token is set, and rejections/timeouts surface as errors', async () => {
  const signed = await startFakeClient({ token: 'shared' })
  try {
    const ack = await sendClientCommand('127.0.0.1', 'identify', { sec: 5 }, { port: signed.port, token: 'shared', timeoutMs: 300 })
    assert.equal(ack.ok, true)
    assert.equal(ack.id, 'fake-1')
    await assert.rejects(
      sendClientCommand('127.0.0.1', 'config', { target: { ip: '127.0.0.1', port: 6100 } }, { port: signed.port, token: 'wrong', timeoutMs: 300 }),
      (err: unknown) => err instanceof ClientCommandError && err.kind === 'rejected',
    )
  } finally {
    signed.close()
  }

  const silent = await startFakeClient({ silent: true })
  try {
    await assert.rejects(
      sendClientCommand('127.0.0.1', 'identify', { sec: 5 }, { port: silent.port, timeoutMs: 100, retries: 1 }),
      (err: unknown) => err instanceof ClientCommandError && err.kind === 'timeout',
    )
    assert.equal(silent.received.length, 2, 'one retry after the first timeout')
  } finally {
    silent.close()
  }
})

test('download catalog resolves known ids and reports missing files', async () => {
  const { findDownload, listDownloads, locateDownload } = await import('../src/lib/downloads')
  assert.equal(findDownload('sound-client')?.file, 'tms-soundsense.exe')
  assert.equal(findDownload('../etc/passwd'), undefined)
  assert.equal(await locateDownload({ id: 'x', name: 'x', description: '', file: 'definitely-missing.exe' }), null)
  const items = await listDownloads()
  assert.ok(items.some(i => i.id === 'sound-client'))
})
