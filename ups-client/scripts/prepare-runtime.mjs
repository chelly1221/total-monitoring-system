import { cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Reuse the WebView2 fixed runtime already unpacked for one of the other clients.
const destination = new URL('../src-tauri/webview2/', import.meta.url);
const shared = ['../../sound-client/src-tauri/webview2/', '../../ping-client/src-tauri/webview2/'].map(p => new URL(p, import.meta.url));
if (!existsSync(new URL('msedgewebview2.exe', destination))) {
  const source = shared.find(url => existsSync(new URL('msedgewebview2.exe', url)));
  if (source) {
    cpSync(source, destination, { recursive: true });
  } else {
    execFileSync(process.execPath, [fileURLToPath(new URL('fetch-webview2.mjs', import.meta.url))], { stdio: 'inherit' });
  }
}
