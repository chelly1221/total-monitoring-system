// Exercise the real release executable using isolated settings and loopback UDP.
// Does not register firewall rules or Windows autostart. No production DB is used.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const exe = process.env.TMS_PING_EXE || fileURLToPath(new URL('../src-tauri/target/release/tms-ping-monitor.exe', import.meta.url));
const dir = fileURLToPath(new URL('../../.review/ping-smoke/', import.meta.url));
mkdirSync(dir, { recursive: true });
const settingsFile = `${dir}/ping-settings.json`;
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
      if (source.port !== 7791 || msg.nonce !== nonce) return;
      clearTimeout(timer); control.off('message', onMessage); resolve(msg);
    };
    control.on('message', onMessage);
    control.send(JSON.stringify({ v: 1, t, nonce, ...fields }), 7791, '127.0.0.1');
  });
}
async function waitUntil(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
let child;
async function start() {
  child = spawn(exe, [], { env: { ...process.env, TMS_PING_DATA_DIR: dir, TMS_PING_TEST_MODE: '1' }, detached: process.argv.includes('--keep-open'), windowsHide: true, stdio: 'ignore' });
  await waitUntil(async () => { try { await command('probe', {}, 300); return true; } catch { return false; } }, 'client startup');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await exited; await delay(200);
}
const id = randomUUID();
const target = (name, address, enabled = true) => ({ name, address, enabled, type: 'pc' });
let keepOpen = false;
try {
  let occupied = false;
  try { await command('probe', {}, 200); occupied = true; } catch { /* expected */ }
  assert.equal(occupied, false, 'Stop the existing ping client before running this isolated smoke test');
  writeFileSync(settingsFile, JSON.stringify({ id, name: '검증용 네트워크 PC', targets: [target('루프백 정상 확인', '127.0.0.1')], sound_enabled: false, autostart: false, auto_monitor: true }));
  await start();
  const here = await command('probe');
  assert.equal(here.kind, 'ping'); assert.equal(here.discoveryPort, 7791); assert.equal(here.id, id);
  const invalid = await command('config', { target: { ip: 'bad', port: 0 } });
  assert.equal(invalid.ok, false);
  const config = { target: { ip: '127.0.0.1', port: receiver.address().port }, on: 'PING_FAIL', off: 'PING_OK', intervalMs: 1000, name: '자동 연결 검증 PC' };
  assert.equal((await command('config', config)).ok, true);
  await waitUntil(() => packets.filter(p => p.payload === 'PING_OK').length >= 2, 'healthy heartbeat');
  assert.equal(packets.some(p => p.payload === 'PING_FAIL'), false);
  const persisted = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(persisted.id, id); assert.equal(persisted.targets[0].address, '127.0.0.1'); assert.equal(persisted.udp_port, String(receiver.address().port));
  assert.equal((await command('identify', { sec: 1 })).ok, true);
  await stop(); packets = [];
  await start();
  await waitUntil(() => packets.some(p => p.payload === 'PING_OK'), 'automatic reconnect after restart');
  assert.equal((await command('probe')).id, id);
  await stop(); packets = [];
  const failedSettings = { ...persisted, timeout_ms: 100, targets: [target('로컬 감시 PC', '127.0.0.1'), target('장애 판정 검증', '192.0.2.1'), target('예비 네트워크 장비', '192.0.2.2', false)] };
  writeFileSync(settingsFile, JSON.stringify(failedSettings));
  await start();
  await waitUntil(() => packets.some(p => p.payload === 'PING_FAIL'), 'fault heartbeat');
  assert.equal(packets.some(p => p.payload === 'PING_OK'), false, 'No healthy heartbeat before all targets have been measured');
  assert.equal((await command('probe')).alarm, true);
  const history = JSON.parse(readFileSync(`${dir}/ping-history.json`, 'utf8'));
  assert.ok(history.some(e => e.address === '192.0.2.1' && e.status === '장애 발생'));
  assert.equal((await command('config', { target: null })).ok, true);
  packets = []; await delay(1300); assert.equal(packets.length, 0, 'Disconnect stops heartbeat');
  keepOpen = process.argv.includes('--keep-open');
  console.log('PASS: real EXE discovery, identify, config rejection/persistence, healthy/fault heartbeat, restart reconnect, disconnect, history');
  if (keepOpen) { writeFileSync(`${dir}/ui-process.json`, JSON.stringify({ pid: child.pid, exe, dir })); child.unref(); console.log(`UI verification process: ${child.pid}`); }
} finally {
  if (!keepOpen) await stop();
  control.close(); receiver.close();
}
