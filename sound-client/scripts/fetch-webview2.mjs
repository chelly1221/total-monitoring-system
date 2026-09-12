// Fetch the WebView2 Fixed Version runtime and unpack it to src-tauri/webview2/.
//
// The client ships the runtime next to the exe (tauri.conf.json bundle.windows.webviewInstallMode
// = fixedRuntime) because facility PCs are offline and some lack the Evergreen runtime. The folder
// is ~180MB and gitignored; this runs as part of `npm run build` and is a no-op once unpacked.
// To move to a newer runtime, change VERSION/URL below (links are listed on
// https://developer.microsoft.com/en-us/microsoft-edge/webview2/ under "Fixed Version") and delete
// src-tauri/webview2/.

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '153.0.4234.32';
const ARCH = 'x64';
const URL = `https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/c3d95bc1-a0a7-4ca6-aaa1-fa0ac3dd1a37/Microsoft.WebView2.FixedVersionRuntime.${VERSION}.${ARCH}.cab`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'src-tauri', 'webview2');
const CACHE_DIR = path.join(ROOT, '.cache');
const CAB = path.join(CACHE_DIR, `Microsoft.WebView2.FixedVersionRuntime.${VERSION}.${ARCH}.cab`);
// Windows' own expand.exe; Git for Windows puts an unrelated Unix `expand` on PATH.
const EXPAND = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'expand.exe');

if (existsSync(path.join(RUNTIME_DIR, 'msedgewebview2.exe'))) {
  console.log(`webview2: fixed runtime present at ${RUNTIME_DIR}`);
  process.exit(0);
}

mkdirSync(CACHE_DIR, { recursive: true });
if (!existsSync(CAB)) {
  console.log(`webview2: downloading ${path.basename(CAB)} ...`);
  const partial = `${CAB}.part`;
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
  renameSync(partial, CAB);
  console.log(`webview2: downloaded ${(statSync(CAB).size / 1024 / 1024).toFixed(1)} MB`);
}

const staging = path.join(CACHE_DIR, 'expand');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
console.log('webview2: extracting ...');
execFileSync(EXPAND, ['-F:*', CAB, staging], { stdio: 'ignore' });

// The cab holds one top-level folder named after the version; flatten it to webview2/.
const entries = readdirSync(staging);
const extracted = entries.length === 1 && statSync(path.join(staging, entries[0])).isDirectory()
  ? path.join(staging, entries[0])
  : staging;
if (!existsSync(path.join(extracted, 'msedgewebview2.exe'))) {
  throw new Error(`msedgewebview2.exe not found after extracting ${CAB}`);
}
rmSync(RUNTIME_DIR, { recursive: true, force: true });
renameSync(extracted, RUNTIME_DIR);
rmSync(staging, { recursive: true, force: true });
writeFileSync(path.join(RUNTIME_DIR, 'VERSION.txt'), `${VERSION} ${ARCH}\n`);
console.log(`webview2: fixed runtime ${VERSION} ${ARCH} ready at ${RUNTIME_DIR}`);
