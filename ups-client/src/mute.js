// Mute-duration popup (separate Tauri window docked above the tray), same flow as SoundSense.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { UNMUTE_PRESETS } from './presets.js';

let defaultMinutes = 10;

function renderGrid() {
  const grid = document.getElementById('popup-grid');
  grid.innerHTML = '';
  for (const p of UNMUTE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'popup-opt' + (p.minutes === defaultMinutes ? ' default' : '');
    btn.textContent = p.label;
    btn.addEventListener('click', () => { void invoke('mute_choose', { minutes: p.minutes }); });
    grid.appendChild(btn);
  }
}

try {
  const snap = await invoke('snapshot');
  defaultMinutes = snap.settings?.unmute_minutes ?? 10;
} catch (e) { console.error(e); }
renderGrid();
document.getElementById('popup-later').addEventListener('click', () => void invoke('mute_popup_dismiss'));
document.getElementById('popup-unmute').addEventListener('click', () => void invoke('unmute_now'));
await listen('snapshot', event => {
  const minutes = event.payload?.settings?.unmute_minutes ?? 10;
  if (minutes !== defaultMinutes) { defaultMinutes = minutes; renderGrid(); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') void invoke('mute_popup_dismiss'); });
