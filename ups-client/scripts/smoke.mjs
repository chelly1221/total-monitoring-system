// Exercise the real release executable using isolated settings, a fake SNMP agent and loopback UDP.
// Does not register firewall rules or Windows autostart. No production DB is used.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const exe = process.env.TMS_UPS_EXE || fileURLToPath(new URL('../src-tauri/target/release/tms-ups-monitor.exe', import.meta.url));
const dir = fileURLToPath(new URL('../../.review/ups-smoke/', import.meta.url));
mkdirSync(dir, { recursive: true });
const settingsFile = `${dir}/ups-settings.json`;
const DISCOVERY_PORT = 7792;

// --- Fake SNMP v2c agent (answers every GET with fixed values for the requested OIDs) ---
const VALUES = {
  '1.3.6.1.2.1.33.1.4.1.0': 3, '1.3.6.1.2.1.33.1.2.1.0': 2, '1.3.6.1.2.1.33.1.3.3.1.3.1': 220, '1.3.6.1.2.1.33.1.4.4.1.2.1': 221,
  '1.3.6.1.2.1.33.1.3.3.1.2.1': 600, '1.3.6.1.2.1.33.1.4.2.0': 600, '1.3.6.1.2.1.33.1.2.5.0': 1350, '1.3.6.1.2.1.33.1.2.4.0': 100, '1.3.6.1.2.1.33.1.2.7.0': 28,
};
let agentState = { ...VALUES };
function tlv(tag, body) { const len = body.length; const lenBytes = len < 0x80 ? [len] : len < 0x100 ? [0x81, len] : [0x82, len >> 8, len & 0xff]; return Buffer.concat([Buffer.from([tag, ...lenBytes]), body]); }
function integer(n) { let bytes = []; let v = n; do { bytes.unshift(v & 0xff); v >>= 8; } while (v > 0 && v !== -1); if (bytes[0] & 0x80) bytes.unshift(0); return tlv(0x02, Buffer.from(bytes)); }
function oidBytes(oid) { const parts = oid.split('.').map(Number); const out = [parts[0] * 40 + parts[1]]; for (const arc of parts.slice(2)) { const chunk = []; let v = arc; do { chunk.unshift(v & 0x7f); v >>= 7; } while (v > 0); for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80; out.push(...chunk); } return tlv(0x06, Buffer.from(out)); }
function readTlv(buf, pos) { const tag = buf[pos]; let len = buf[pos + 1]; let p = pos + 2; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | buf[p++]; } return { tag, body: buf.subarray(p, p + len), next: p + len }; }
function decodeOid(body) { const out = [Math.floor(body[0] / 40), body[0] % 40]; let acc = 0; for (const b of body.subarray(1)) { acc = (acc << 7) | (b & 0x7f); if (!(b & 0x80)) { out.push(acc); acc = 0; } } return out.join('.'); }
function answer(request) {
  const msg = readTlv(request, 0); let p = 0; const version = readTlv(msg.body, p); p = version.next; const community = readTlv(msg.body, p); p = community.next; const pdu = readTlv(msg.body, p);
  let q = 0; const reqId = readTlv(pdu.body, q); q = reqId.next; q = readTlv(pdu.body, q).next; q = readTlv(pdu.body, q).next; const list = readTlv(pdu.body, q);
  const varbinds = []; let r = 0;
  while (r < list.body.length) { const vb = readTlv(list.body, r); r = vb.next; const oid = decodeOid(readTlv(vb.body, 0).body); const value = agentState[oid]; varbinds.push(tlv(0x30, Buffer.concat([oidBytes(oid), value === undefined ? tlv(0x81, Buffer.alloc(0)) : integer(value)]))); }
  const body = Buffer.concat([tlv(0x02, reqId.body), integer(0), integer(0), tlv(0x30, Buffer.concat(varbinds))]);
  return tlv(0x30, Buffer.concat([integer(1), tlv(0x04, community.body), tlv(0xa2, body)]));
}
const agent = dgram.createSocket('udp4');
agent.on('message', (raw, rinfo) => { try { agent.send(answer(raw), rinfo.port, rinfo.address); } catch (e) { console.error('agent', e); } });
await new Promise(resolve => agent.bind(0, '127.0.0.1', resolve));

const control = dgram.createSocket('udp4');
const receiver = dgram.createSocket('udp4');
await new Promise(resolve => control.bind(0, '127.0.0.1', resolve));
await new Promise(resolve => receiver.bind(0, '127.0.0.1', resolve));
let packets = [];
receiver.on('message', raw => packets.push({ payload: raw.toString(), at: Date.now() }));
function command(t, fields = {}, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const nonce = randomBytes(8).toString('hex');
    const timer = setTimeout(() => { control.off('message', onMessage); reject(new Error(`${t} timeout`)); }, timeout);
    const onMessage = (raw, source) => {
      const msg = JSON.parse(raw.toString());
      if (source.port !== DISCOVERY_PORT || msg.nonce !== nonce) return;
      clearTimeout(timer); control.off('message', onMessage); resolve(msg);
    };
    control.on('message', onMessage);
    control.send(JSON.stringify({ v: 1, t, nonce, ...fields }), DISCOVERY_PORT, '127.0.0.1');
  });
}
async function waitUntil(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
let child;
async function start() {
  child = spawn(exe, [], { env: { ...process.env, TMS_UPS_DATA_DIR: dir, TMS_UPS_TEST_MODE: '1' }, detached: process.argv.includes('--keep-open'), windowsHide: true, stdio: 'ignore' });
  await waitUntil(async () => { try { await command('probe', {}, 300); return true; } catch { return false; } }, 'client startup');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await exited; await delay(200);
}
const id = randomUUID();
const agentAddress = `127.0.0.1:${agent.address().port}`;
let keepOpen = false;
try {
  let occupied = false;
  try { await command('probe', {}, 200); occupied = true; } catch { /* expected */ }
  assert.equal(occupied, false, 'Stop the existing UPS client before running this isolated smoke test');
  const unit = (ip) => ({ ip, community: 'public', interval_sec: 1, server_enabled: false, server_ip: '', server_port: 0, sound_file: '', muted: false, limits: {} });
  writeFileSync(settingsFile, JSON.stringify({ id, name: '검증용 UPS PC', units: [unit('192.0.2.1'), unit(agentAddress)], sound_enabled: false, autostart: false, auto_monitor: true }));
  await start();
  const here = await command('probe');
  assert.equal(here.kind, 'ups'); assert.equal(here.discoveryPort, DISCOVERY_PORT); assert.equal(here.id, id); assert.equal(here.units.length, 2);
  const invalid = await command('config', { target: { ip: '127.0.0.1', port: receiver.address().port } });
  assert.equal(invalid.ok, false, 'unit is required');
  const config = { target: { ip: '127.0.0.1', port: receiver.address().port }, unit: 2, intervalMs: 1000, name: '자동 연결 검증 UPS PC' };
  assert.equal((await command('config', config)).ok, true);
  await waitUntil(() => packets.length >= 2, 'UPS#2 readings forwarded');
  const reading = JSON.parse(packets[0].payload);
  assert.equal(reading.UPS, 2); assert.equal(reading.Data['출력 상태'], '정상'); assert.equal(reading.Data['배터리 전압 (V)'], '13.50 V'); assert.equal(reading.Data['배터리 온도 (°C)'], '28°C');
  assert.equal(packets.some(p => JSON.parse(p.payload).UPS === 1), false, 'UPS#1 is not bound to the server');
  const persisted = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(persisted.id, id); assert.equal(persisted.units[1].server_port, receiver.address().port); assert.equal(persisted.name, '자동 연결 검증 UPS PC');
  assert.equal((await command('identify', { sec: 1 })).ok, true);
  const bound = await command('probe');
  assert.equal(bound.units[1].target.port, receiver.address().port); assert.equal(bound.units[1].alarm, false);
  assert.equal(bound.units[0].alarm, null, 'unreachable UPS#1 has no verdict yet');
  // UPS#2 goes on battery: after 5 consecutive polls the client reports an alarm.
  agentState = { ...VALUES, '1.3.6.1.2.1.33.1.4.1.0': 5 };
  await waitUntil(async () => (await command('probe')).units[1].alarm === true, 'battery alarm after five polls', 20000);
  agentState = { ...VALUES };
  await waitUntil(async () => (await command('probe')).units[1].alarm === false, 'alarm clears');
  await stop(); packets = [];
  await start();
  await waitUntil(() => packets.length >= 1, 'automatic reconnect after restart');
  assert.equal((await command('probe')).id, id);
  assert.equal((await command('config', { target: null, unit: 2 })).ok, true);
  packets = []; await delay(1500); assert.equal(packets.length, 0, 'Disconnect stops forwarding');
  keepOpen = process.argv.includes('--keep-open');
  console.log('PASS: real EXE discovery, identify, config rejection/persistence, SNMP readings forwarded, alarm debounce, restart reconnect, disconnect');
  if (keepOpen) { writeFileSync(`${dir}/ui-process.json`, JSON.stringify({ pid: child.pid, exe, dir })); child.unref(); console.log(`UI verification process: ${child.pid}`); }
} finally {
  if (!keepOpen) await stop();
  control.close(); receiver.close(); agent.close();
}
