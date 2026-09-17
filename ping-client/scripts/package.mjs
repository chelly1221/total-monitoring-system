// Package the portable distribution: src-tauri/target/release/tms-ping-monitor.zip holding the exe,
// the WebView2 fixed runtime folder it needs next to it, and the Npcap installer the client offers
// to run on first start when packet capture is not available. Run after `cargo tauri build --no-bundle`.
// The server's build-standalone.js calls this and bundles the zip for the 다운로드 menu.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'src-tauri', 'target', 'release');
const EXE = 'tms-ping-monitor.exe';
const RUNTIME = 'webview2';
const NPCAP = 'npcap-installer.exe';
const ZIP = path.join(RELEASE, 'tms-ping-monitor.zip');
// Windows' bsdtar (writes zip with -a); Git for Windows' GNU tar on PATH cannot.
const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
// Same Npcap source and pinned hash as build-setup.mjs (free edition unless TMS_NPCAP_OEM_INSTALLER is set).
const oem = process.env.TMS_NPCAP_OEM_INSTALLER;
const npcapSource = oem ? path.resolve(oem) : path.join(ROOT, '.cache/npcap-1.89.exe');
const freeHash = '8aed85e900d783d1308506e919587d3e540451947af8a82f2d04f819e44305cc';

for (const required of [EXE, path.join(RUNTIME, 'msedgewebview2.exe')]) {
  if (!existsSync(path.join(RELEASE, required))) {
    console.error(`package: ${path.join(RELEASE, required)} missing; run \`cargo tauri build --no-bundle\` first`);
    process.exit(1);
  }
}

if (!existsSync(npcapSource) && !oem) {
  mkdirSync(path.dirname(npcapSource), { recursive: true });
  const response = await fetch('https://npcap.com/dist/npcap-1.89.exe', { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Npcap 다운로드 실패: HTTP ${response.status}`);
  writeFileSync(npcapSource, Buffer.from(await response.arrayBuffer()));
}
const npcapHash = createHash('sha256').update(readFileSync(npcapSource)).digest('hex');
if (!oem && npcapHash !== freeHash) throw new Error('Npcap 설치 파일의 SHA-256이 일치하지 않습니다.');
cpSync(npcapSource, path.join(RELEASE, NPCAP));

rmSync(ZIP, { force: true });
execFileSync(TAR, ['-a', '-cf', ZIP, '-C', RELEASE, EXE, NPCAP, RUNTIME], { stdio: 'inherit' });
console.log(`package: ${ZIP} (${(statSync(ZIP).size / 1024 / 1024).toFixed(1)} MB, Npcap ${oem ? 'OEM' : '무료판'} 설치 파일 포함)`);
