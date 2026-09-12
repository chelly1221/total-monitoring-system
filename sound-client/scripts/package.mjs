// Package the portable distribution: src-tauri/target/release/tms-soundsense.zip holding the exe
// and the WebView2 fixed runtime folder it needs next to it. Run after `cargo tauri build --no-bundle`.
// The server's build-standalone.js calls this and bundles the zip for the 다운로드 menu.

import { existsSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'src-tauri', 'target', 'release');
const EXE = 'tms-soundsense.exe';
const RUNTIME = 'webview2';
const ZIP = path.join(RELEASE, 'tms-soundsense.zip');
// Windows' bsdtar (writes zip with -a); Git for Windows' GNU tar on PATH cannot.
const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

for (const required of [EXE, path.join(RUNTIME, 'msedgewebview2.exe')]) {
  if (!existsSync(path.join(RELEASE, required))) {
    console.error(`package: ${path.join(RELEASE, required)} missing; run \`cargo tauri build --no-bundle\` first`);
    process.exit(1);
  }
}

rmSync(ZIP, { force: true });
execFileSync(TAR, ['-a', '-cf', ZIP, '-C', RELEASE, EXE, RUNTIME], { stdio: 'inherit' });
console.log(`package: ${ZIP} (${(statSync(ZIP).size / 1024 / 1024).toFixed(1)} MB)`);
