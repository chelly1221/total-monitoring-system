import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './workspace.css';
import './topoEditor.js';
import './view2d.js';

const win = getCurrentWindow();
const callbacks = new Map();
const eventNames = ['ping-result', 'failure-log', 'traffic-stats', 'internode-stats', 'asterix-flows', 'capture-error', 'window-maximized', 'window-unmaximized'];
const on = (name, callback) => { if (!callbacks.has(name)) callbacks.set(name, new Set()); callbacks.get(name).add(callback); return () => callbacks.get(name)?.delete(callback); };
let toastTimer;
window.notify = (message) => {
  const el = document.getElementById('toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
};
window.addEventListener('unhandledrejection', e => { window.notify(String(e.reason)); });
window.api = {
  snapshot: () => invoke('snapshot'),
  getSettings: async () => (await invoke('snapshot')).settings,
  saveSettings: patch => invoke('save_settings', { patch }),
  startPinging: () => invoke('set_running', { running: true }),
  stopPinging: () => invoke('set_running', { running: false }),
  clearLogs: () => invoke('clear_logs'),
  queryLogs: (cursor, search, status) => invoke('query_logs', { cursor, search, status }),
  browseSoundFile: () => invoke('browse_sound'),
  testSound: (path = '') => invoke('test_sound', { path }),
  importSettings: () => invoke('import_settings'),
  exportSettings: patch => invoke('export_settings', { patch }),
  updateMute: async mute => { await invoke('save_settings', { patch: { mute_state: mute } }); return true; },
  windowMinimize: () => win.minimize(),
  windowMaximize: () => win.toggleMaximize(),
  windowClose: () => win.hide(),
  windowIsMaximized: () => win.isMaximized(),
  getLocalIp: async () => {
    try { const interfaces = await invoke('capture_interfaces'); return interfaces[0]?.addresses[0] || ''; } catch { return ''; }
  },
  isNpcapAvailable: async () => { try { await invoke('capture_interfaces'); return true; } catch { return false; } },
  getNetworkInterfaces: () => invoke('capture_interfaces'),
  saveCaptureSettings: patch => invoke('save_settings', { patch }),
  removeAllListeners: name => callbacks.get(name)?.clear(),
};
for (const name of eventNames) {
  const method = 'on' + name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
  window.api[method] = callback => on(name, callback);
  await listen(name, event => { for (const callback of callbacks.get(name) || []) callback(event.payload); });
}
window.api.onInterNodeStats = callback => on('internode-stats', callback);
let identifyTimer;
await listen('identify', event => {
  const banner = document.getElementById('identifyBanner'); banner.hidden = false;
  clearTimeout(identifyTimer); identifyTimer = setTimeout(() => { banner.hidden = true; }, event.payload * 1000);
});
let trafficAt = 0;
await listen('traffic-summary', event => {
  trafficAt = Date.now();
  const { bytes, packets, asterixFlows } = event.payload;
  const el = document.getElementById('trafficSummary');
  el.textContent = `${(bytes / 1024).toFixed(1)} KB/s · ${packets} 패킷/s · ASTERIX ${asterixFlows} 흐름`;
});
const traffic = document.createElement('span'); traffic.id = 'trafficSummary'; traffic.textContent = '패킷 캡처 대기';
document.getElementById('statusbar')?.appendChild(traffic);
setInterval(() => { if (Date.now() - trafficAt > 3000) traffic.textContent = '패킷 캡처 대기'; }, 1000);
const ui = await import('./renderer.js');
await listen('snapshot', event => ui.syncSnapshot(event.payload));
await ui.init();

// Modal focus stays inside the active dialog; Escape restores the opener.
let opener = null;
const modalObserver = new MutationObserver(records => {
  for (const record of records) {
    const modal = record.target;
    if (modal.classList.contains('show')) {
      if (!modal.contains(document.activeElement)) { opener = document.activeElement; modal.querySelector('input,button,select')?.focus(); }
    } else if (modal.contains(document.activeElement)) { opener?.focus(); }
  }
});
document.querySelectorAll('.modal-overlay').forEach(modal => modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] }));
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const modal = document.querySelector('.modal-overlay.show'); if (!modal) return;
  const elements = [...modal.querySelectorAll('button,input,select,[tabindex="0"]')].filter(el => !el.disabled && el.offsetParent !== null);
  const first = elements[0], last = elements.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
});
