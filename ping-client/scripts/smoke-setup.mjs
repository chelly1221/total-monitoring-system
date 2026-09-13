// Exercise the shipping NSIS installer without changing drivers, firewall, or operational data.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const setup = path.join(root, 'src-tauri/target/release/tms-ping-monitor-setup.exe');
const dir = path.resolve(root, '../.review', `ping-setup-${randomUUID()}`);
const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\네트워크 ping 감시';
const preferencesKey = 'HKCU\\Software\\chelly\\네트워크 ping 감시';
assert.notEqual(spawnSync('reg.exe', ['query', registryKey], { windowsHide: true }).status, 0,
  'An installed ping client already exists; do not replace it during verification');
assert.ok(existsSync(setup), 'Build the Setup first');
mkdirSync(dir, { recursive: true });
const preferencesBackup = path.join(dir, 'installer-preferences.reg');
const hadPreferences = spawnSync('reg.exe', ['export', preferencesKey, preferencesBackup, '/y'], { windowsHide: true }).status === 0;

async function run(file, args, expected = 0) {
  const child = spawn(file, args, { windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, expected, `${path.basename(file)} exit code`);
}
const exe = path.join(dir, 'tms-ping-monitor.exe');
const uninstaller = path.join(dir, 'uninstall.exe');
try {
  const manifest = JSON.parse(readFileSync(path.join(root, 'src-tauri/target/release/setup-manifest.json'), 'utf8'));
  assert.equal(manifest.offline, true, 'Only self-contained offline Setup is distributed');
  if (manifest.npcap === 'bundled-free') {
    await run(setup, ['/S', `/D=${dir}`], 20);
    assert.equal(existsSync(exe), false, 'Free Npcap cannot be installed unattended');
  }
  await run(setup, ['/S', '/SKIPNETWORK', `/D=${dir}`]);
  assert.ok(existsSync(exe));
  assert.ok(existsSync(path.join(dir, 'webview2/msedgewebview2.exe')));
  assert.ok(existsSync(uninstaller));
  execFileSync('reg.exe', ['query', registryKey, '/v', 'UninstallString'], { windowsHide: true, stdio: 'ignore' });
  const settings = path.join(dir, 'ping-settings.json');
  const saved = JSON.stringify({ id: randomUUID(), name: '설치 보존 검증' });
  writeFileSync(settings, saved);
  await run(setup, ['/S', '/SKIPNETWORK', `/D=${dir}`]);
  assert.equal(readFileSync(settings, 'utf8'), saved, 'Reinstall must preserve settings');
  execFileSync(process.execPath, [path.join(root, 'scripts/smoke.mjs')], {
    cwd: root, env: { ...process.env, TMS_PING_EXE: exe }, stdio: 'inherit',
  });
} finally {
  if (existsSync(uninstaller)) {
    // NSIS requires _?= to be last; run in place so its completion can be awaited.
    await run(uninstaller, ['/S', `_?=${dir}`]);
    for (let i = 0; i < 30 && existsSync(exe); i++) await delay(200);
  }
  // NSIS retains the last install directory even after uninstall. Restore the user's state.
  spawnSync('reg.exe', ['delete', preferencesKey, '/f'], { windowsHide: true });
  if (hadPreferences) execFileSync('reg.exe', ['import', preferencesBackup], { windowsHide: true, stdio: 'ignore' });
}
assert.equal(existsSync(exe), false, 'Uninstall must remove the application');
assert.equal(existsSync(path.join(dir, 'webview2/msedgewebview2.exe')), false);
assert.ok(existsSync(path.join(dir, 'ping-settings.json')), 'Uninstall must preserve monitoring settings');
assert.notEqual(spawnSync('reg.exe', ['query', registryKey], { windowsHide: true }).status, 0);
console.log(`PASS: Setup install, reinstall, real EXE protocol, uninstall, settings retained (${dir})`);
