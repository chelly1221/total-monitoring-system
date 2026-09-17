// Build the Korean NSIS installer (program + WebView2 fixed runtime, offline) and copy it to
// src-tauri/target/release/tms-ups-monitor-setup.exe with a small manifest.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync('cargo', ['tauri', 'build', '--bundles', 'nsis'], { cwd: root, stdio: 'inherit' });
const conf = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const release = path.join(root, 'src-tauri/target/release');
const setup = path.join(release, 'bundle/nsis', `${conf.productName}_${conf.version}_x64-setup.exe`);
if (!existsSync(setup)) throw new Error(`설치 파일을 찾을 수 없습니다: ${setup}`);
cpSync(setup, path.join(release, 'tms-ups-monitor-setup.exe'));
writeFileSync(path.join(release, 'setup-manifest.json'), JSON.stringify({
  version: conf.version, offline: true,
  sha256: createHash('sha256').update(readFileSync(setup)).digest('hex'),
}, null, 2));
console.log(`Setup: ${setup} (WebView2 내장)`);
