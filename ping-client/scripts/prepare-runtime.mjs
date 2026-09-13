import { cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const destination = new URL('../src-tauri/webview2/', import.meta.url);
const shared = new URL('../../sound-client/src-tauri/webview2/', import.meta.url);
if (!existsSync(new URL('msedgewebview2.exe', destination))) {
  if (existsSync(new URL('msedgewebview2.exe', shared))) {
    cpSync(shared, destination, { recursive: true });
  } else {
    execFileSync(process.execPath, [fileURLToPath(new URL('fetch-webview2.mjs', import.meta.url))], { stdio: 'inherit' });
  }
}
