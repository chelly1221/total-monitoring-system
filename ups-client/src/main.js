import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './workspace.css';
import './ups.css';
import './mute.css';

const win = getCurrentWindow();
let toastTimer;
window.notify = (message) => {
  const el = document.getElementById('toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
};
window.addEventListener('unhandledrejection', e => { window.notify(String(e.reason)); });
window.api = {
  snapshot: () => invoke('snapshot'),
  saveSettings: patch => invoke('save_settings', { patch }),
  start: () => invoke('set_running', { running: true }),
  stop: () => invoke('set_running', { running: false }),
  clearLogs: unit => invoke('clear_logs', { unit }),
  browseSoundFile: () => invoke('browse_sound'),
  testSound: (path, unit) => invoke('test_sound', { path, unit }),
  importSettings: () => invoke('import_settings'),
  exportSettings: patch => invoke('export_settings', { patch }),
  muteChoose: minutes => invoke('mute_choose', { minutes }),
  muteCancel: () => invoke('mute_cancel'),
  unmuteNow: () => invoke('unmute_now'),
  windowMinimize: () => win.minimize(),
  windowMaximize: () => win.toggleMaximize(),
  windowClose: () => win.hide(),
  windowIsMaximized: () => win.isMaximized(),
};
let identifyTimer;
await listen('identify', event => {
  const banner = document.getElementById('identifyBanner'); banner.hidden = false;
  clearTimeout(identifyTimer); identifyTimer = setTimeout(() => { banner.hidden = true; }, event.payload * 1000);
});
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
