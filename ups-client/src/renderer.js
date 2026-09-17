import { UNMUTE_PRESETS, presetLabel, formatRemaining } from './presets.js';
// UI state: the Rust side pushes a full snapshot after every poll and once a second.
let settings = {};
let params = { 1: [], 2: [] };
let isRunning = false;
let latestSnapshot = null;
let editingUnit = 1;
let editingSound = '';

const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');

const UNIT_LABELS = { 1: 'UPS#1', 2: 'UPS#2' };
// Layout of the readings per unit: a phase table for the 3-phase card, tiles for the rest.
const LAYOUT = {
  1: {
    phases: {
      rows: ['R', 'S', 'T'],
      columns: [
        { title: '입력 전압', label: p => `입력 전압 ${p} (V)` },
        { title: '입력 전류', label: p => `입력 전류 ${p} (A)` },
        { title: '입력 전력', label: p => `입력 전력 ${p} (kW)` },
        { title: '출력 전압', label: p => `출력 전압 ${p} (V)` },
        { title: '출력 전류', label: p => `출력 전류 ${p} (A)` },
        { title: '출력 부하', label: p => `출력 ${p} (%)` },
      ],
    },
    tiles: ['출력 상태', '배터리 상태', '입력 주파수 (Hz)', '출력 주파수(Hz)', '배터리 전압(V)', '배터리 잔량(%)'],
  },
  2: {
    tiles: ['출력 상태', '배터리 상태', '입력 전압 (V)', '출력 전압 (V)', '입력 주파수 (Hz)', '출력 주파수 (Hz)', '배터리 전압 (V)', '배터리 잔량 (%)', '배터리 온도 (°C)'],
  },
};
const STATUS_LABELS = new Set(['출력 상태', '배터리 상태']);

async function init() {
  syncSnapshot(await window.api.snapshot());
  bindEvents();
  updateClock();
  setInterval(updateClock, 1000);
}

function unitRow(unit) { return document.getElementById('ups' + unit); }
function role(unit, name) { return unitRow(unit).querySelector(`[data-role="${name}"]`); }

// --- Readings ---
function valueClass(label, value, levels) {
  if (value === 'No Data' || value === undefined) return 'nodata';
  if (STATUS_LABELS.has(label)) return value === '정상' || value === '온라인' ? 'good' : 'bad';
  const level = levels[label];
  return level === 'low' || level === 'high' ? 'bad' : '';
}

function renderReadings(unit, live) {
  const body = role(unit, 'body');
  const data = new Map(live.data || []);
  const levels = live.levels || {};
  if (data.size === 0) {
    body.innerHTML = `<div class="empty-state"><strong>${isRunning ? '첫 응답을 기다리는 중입니다' : '감시가 정지되어 있습니다'}</strong><p>${escapeHtml(settings.units?.[unit - 1]?.ip || '')} · SNMP v2c · ${UNIT_LABELS[unit]} 설정에서 주소를 확인하세요.</p></div>`;
    return;
  }
  const layout = LAYOUT[unit];
  let html = '';
  if (layout.phases) {
    html += '<table class="phase-table"><thead><tr><th scope="col">상</th>' + layout.phases.columns.map(c => `<th scope="col">${c.title}</th>`).join('') + '</tr></thead><tbody>';
    for (const phase of layout.phases.rows) {
      html += `<tr><td>${phase}</td>` + layout.phases.columns.map(c => {
        const label = c.label(phase); const value = data.get(label);
        return `<td class="${valueClass(label, value, levels)}" title="${escapeAttr(label)}">${escapeHtml(display(value))}</td>`;
      }).join('') + '</tr>';
    }
    html += '</tbody></table>';
  }
  html += '<div class="tile-grid">' + layout.tiles.map(label => {
    const value = data.get(label);
    const cls = valueClass(label, value, levels);
    return `<div class="tile ${STATUS_LABELS.has(label) ? 'status' : ''} ${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(display(value))}</strong></div>`;
  }).join('') + '</div>';
  body.innerHTML = html;
}

function display(value) { return value === undefined || value === '' ? '불러오는 중…' : value; }

function renderHeader(unit, live) {
  const data = new Map(live.data || []);
  const chip = (name, label, key) => {
    const el = role(unit, name); const value = data.get(key);
    el.textContent = `${label} ${value === undefined ? '—' : value}`;
    el.className = 'ups-chip ' + (value === undefined || value === 'No Data' ? 'idle' : (value === '정상' || value === '온라인') ? 'good' : 'bad');
  };
  chip('output', '출력', '출력 상태');
  chip('battery', '배터리', '배터리 상태');
  const poll = role(unit, 'poll');
  poll.textContent = (live.pollStatus || '대기 중') + (live.lastPollAt ? ' · ' + formatTime(live.lastPollAt) : '');
  const summary = document.querySelector(`.ups-summary[data-unit="${unit}"]`);
  if (!isRunning) { summary.textContent = '정지'; summary.className = 'ups-summary idle'; }
  else if (live.alarmActive) { summary.textContent = '경보'; summary.className = 'ups-summary bad'; }
  else if (live.reachable === false) { summary.textContent = '응답 없음'; summary.className = 'ups-summary bad'; }
  else if (live.reachable === true) { summary.textContent = Object.values(live.levels || {}).some(l => l === 'low' || l === 'high') ? '범위 이탈' : '정상'; summary.className = 'ups-summary ' + (summary.textContent === '정상' ? 'good' : 'bad'); }
  else { summary.textContent = '대기'; summary.className = 'ups-summary idle'; }
  unitRow(unit).classList.toggle('alarm', !!live.alarmActive);
}

// --- Event log ---
const lastLogKey = { 1: '', 2: '' };
function renderLogs(unit, logs) {
  const key = logs.length + ':' + (logs.at(-1)?.at ?? 0) + ':' + (logs[0]?.at ?? 0);
  role(unit, 'logCount').textContent = logs.length + '건';
  if (lastLogKey[unit] === key) return;
  lastLogKey[unit] = key;
  const body = role(unit, 'logs');
  if (logs.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td class="empty-state"><strong>이벤트 없음</strong><p>임계값 이탈, 상태 변경, SNMP 오류가 여기에 기록됩니다.</p></td></tr>';
    return;
  }
  const scroll = body.closest('.log-scroll');
  const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 8;
  body.innerHTML = logs.map(log => `<tr class="${log.level === 'warn' ? 'log-error' : (log.message.startsWith('✅') || log.message.startsWith('🔕')) ? 'log-recovery' : ''}"><td class="log-time">${formatTime(log.at, true)}</td><td>${escapeHtml(log.message)}</td></tr>`).join('');
  if (atBottom) scroll.scrollTop = scroll.scrollHeight;
}

// --- Status bar ---
function updateStatusBar(snap) {
  document.getElementById('statusIndicator').classList.toggle('running', isRunning);
  const anyAlarm = snap.units.some(u => u.alarmActive);
  document.getElementById('statusText').textContent = !isRunning ? '감시 정지' : anyAlarm ? 'UPS 경보 발생' : '감시 중';
  for (const unit of [1, 2]) {
    const cfg = settings.units[unit - 1]; const live = snap.units[unit - 1];
    const target = document.querySelector(`[data-conn-target="${unit}"]`);
    target.textContent = cfg.server_enabled ? `${UNIT_LABELS[unit]} → ${cfg.server_ip}:${cfg.server_port}` : `${UNIT_LABELS[unit]} 서버 대기`;
    target.title = live.sendStatus || '';
    const fresh = cfg.server_enabled && isRunning && live.lastSentAt != null && Date.now() - live.lastSentAt < cfg.interval_sec * 3000;
    document.querySelector(`.connection-dot[data-conn="${unit}"]`).classList.toggle('active', fresh);
  }
  const bound = settings.units.filter(u => u.server_enabled).length;
  document.getElementById('connectionStatus').textContent = bound === 0 ? '시설 등록 화면에서 이 PC를 검색하세요.' : snap.units.map((u, i) => settings.units[i].server_enabled ? `${UNIT_LABELS[i + 1]} ${u.sendStatus}` : '').filter(Boolean).join(' · ');
  const transferEl = document.getElementById('transferStatus');
  transferEl.textContent = snap.transferStatus || '';
  transferEl.hidden = !snap.transferStatus;
}

function updateClock() {
  const now = new Date();
  document.getElementById('statusTime').textContent = now.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// --- Modals ---
function showModal(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  document.querySelectorAll('.modal-overlay.show').forEach(m => { if (m.id !== id) m.classList.remove('show'); });
  if (el.classList.contains('show')) return false;
  el.classList.add('show');
  return true;
}
function hideModal(id) { document.getElementById(id)?.classList.remove('show'); }

function openUpsModal(unit) {
  editingUnit = unit;
  const cfg = settings.units[unit - 1];
  editingSound = cfg.sound_file || '';
  document.getElementById('upsModalTitle').textContent = `${UNIT_LABELS[unit]} 설정`;
  document.getElementById('inputUpsIp').value = cfg.ip;
  document.getElementById('inputCommunity').value = cfg.community;
  document.getElementById('inputInterval').value = cfg.interval_sec;
  document.getElementById('chkServerEnabled').checked = cfg.server_enabled;
  document.getElementById('inputServerIp').value = cfg.server_ip;
  document.getElementById('inputServerPort').value = cfg.server_port || '';
  document.getElementById('inputSoundFile').value = editingSound;
  const limits = cfg.limits || {};
  document.getElementById('limitsBody').innerHTML = params[unit].filter(p => p.limit).map(p => {
    const l = limits[p.limit] || { min: 0, max: 0 };
    return `<tr><td>${escapeHtml(p.label)}</td><td><input type="number" step="any" data-limit="${escapeAttr(p.limit)}" data-bound="min" value="${l.min}"></td><td><input type="number" step="any" data-limit="${escapeAttr(p.limit)}" data-bound="max" value="${l.max}"></td></tr>`;
  }).join('');
  selectUpsTab('general');
  showModal('upsModal');
}

function selectUpsTab(tab) {
  document.querySelectorAll('.ups-tab').forEach(b => { const active = b.dataset.tab === tab; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); });
  document.querySelectorAll('.ups-tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
}

async function saveUpsModal() {
  const ip = document.getElementById('inputUpsIp').value.trim();
  const community = document.getElementById('inputCommunity').value.trim();
  const interval = parseInt(document.getElementById('inputInterval').value, 10);
  const serverEnabled = document.getElementById('chkServerEnabled').checked;
  const serverIp = document.getElementById('inputServerIp').value.trim();
  const serverPort = parseInt(document.getElementById('inputServerPort').value, 10);
  if (!ip) return window.notify('UPS 주소를 입력하세요');
  if (!community) return window.notify('Community를 입력하세요');
  if (!Number.isInteger(interval) || interval < 1 || interval > 3600) return window.notify('갱신 간격은 1~3600초 범위입니다');
  if (serverEnabled && (!isValidIp(serverIp) || !(serverPort >= 1 && serverPort <= 65535))) return window.notify('서버 IP 또는 포트를 확인하세요');
  const limits = {};
  for (const input of document.querySelectorAll('#limitsBody input')) {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return window.notify('임계값은 숫자로 입력하세요');
    limits[input.dataset.limit] ??= { min: 0, max: 0 };
    limits[input.dataset.limit][input.dataset.bound] = v;
  }
  for (const [key, l] of Object.entries(limits)) if (l.min > l.max) return window.notify(`최소가 최대보다 큽니다: ${params[editingUnit].find(p => p.limit === key)?.label || key}`);
  const patch = { ip, community, interval_sec: interval, server_enabled: serverEnabled, server_ip: serverIp, server_port: Number.isInteger(serverPort) ? serverPort : 0, sound_file: editingSound, limits };
  try {
    await window.api.saveSettings({ units: { [editingUnit]: patch } });
    hideModal('upsModal');
    window.notify(`${UNIT_LABELS[editingUnit]} 설정을 저장했습니다`);
  } catch (e) { window.notify(String(e)); }
}

function openSoundModal() {
  document.getElementById('chkSoundEnabled').checked = !!settings.sound_enabled;
  document.getElementById('chkMute1').checked = !!settings.units[0].muted;
  document.getElementById('chkMute2').checked = !!settings.units[1].muted;
  const select = document.getElementById('selectUnmuteMinutes');
  const minutes = settings.unmute_minutes ?? 10;
  select.innerHTML = UNMUTE_PRESETS.map(p => `<option value="${p.minutes}">${p.label}</option>`).join('') + (UNMUTE_PRESETS.some(p => p.minutes === minutes) ? '' : `<option value="${minutes}">${presetLabel(minutes)}</option>`);
  select.value = String(minutes);
  renderPcMute(latestSnapshot);
  showModal('soundModal');
}

async function saveSoundModal() {
  try {
    await window.api.saveSettings({
      sound_enabled: document.getElementById('chkSoundEnabled').checked,
      unmute_minutes: Number(document.getElementById('selectUnmuteMinutes').value),
      units: { 1: { muted: document.getElementById('chkMute1').checked }, 2: { muted: document.getElementById('chkMute2').checked } },
    });
    hideModal('soundModal');
  } catch (e) { window.notify(String(e)); }
}

// PC 음소거 자동 해제 (Windows endpoint mute watched by the Rust side, as in SoundSense).
function renderPcMute(snap) {
  if (!snap) return;
  const chip = document.getElementById('pcMuteChip');
  const remaining = document.getElementById('pcMuteRemaining');
  const running = snap.pcMuted && snap.unmuteRemainingSec != null;
  chip.textContent = snap.pcMuted ? (running ? '음소거됨 · 자동 해제 대기' : '음소거됨') : 'PC 소리 켜짐';
  chip.classList.toggle('muted', !!snap.pcMuted);
  remaining.textContent = running ? formatRemaining(snap.unmuteRemainingSec) + ' 후 해제' : '';
  document.getElementById('btnPcCancelTimer').disabled = !running;
  const grid = document.getElementById('pcMuteGrid');
  const minutes = snap.settings?.unmute_minutes ?? 10;
  if (grid.dataset.minutes !== String(minutes)) {
    grid.dataset.minutes = String(minutes);
    grid.innerHTML = UNMUTE_PRESETS.map(p => `<button type="button" class="popup-opt${p.minutes === minutes ? ' default' : ''}" data-minutes="${p.minutes}" title="${p.label} 후 자동 해제">${p.label}</button>`).join('');
  }
}

function fillClientSettings() {
  document.getElementById('clientName').value = settings.name || '';
  document.getElementById('clientAutostart').checked = !!settings.autostart;
  document.getElementById('clientAutoMonitor').checked = !!settings.auto_monitor;
  document.getElementById('clientDiscovery').textContent = (latestSnapshot?.discoveryStatus || '') + ' · 파일 수신 폴더: received';
}

function clientPatch() {
  return { name: document.getElementById('clientName').value.trim(), autostart: document.getElementById('clientAutostart').checked, auto_monitor: document.getElementById('clientAutoMonitor').checked };
}

// --- Events ---
function bindEvents() {
  btnStart.addEventListener('click', () => window.api.start().catch(e => window.notify(String(e))));
  btnStop.addEventListener('click', () => window.api.stop().catch(e => window.notify(String(e))));
  document.getElementById('menuUps1').addEventListener('click', () => openUpsModal(1));
  document.getElementById('menuUps2').addEventListener('click', () => openUpsModal(2));
  document.getElementById('menuSound').addEventListener('click', openSoundModal);
  document.getElementById('menuClient').addEventListener('click', () => { fillClientSettings(); showModal('clientModal'); });
  document.querySelectorAll('.ups-tab').forEach(b => b.addEventListener('click', () => selectUpsTab(b.dataset.tab)));
  document.getElementById('btnCancelUps').addEventListener('click', () => hideModal('upsModal'));
  document.getElementById('btnSaveUps').addEventListener('click', saveUpsModal);
  document.getElementById('btnBrowseSound').addEventListener('click', async () => {
    const file = await window.api.browseSoundFile();
    if (file) { editingSound = file; document.getElementById('inputSoundFile').value = file; }
  });
  document.getElementById('btnDefaultSound').addEventListener('click', () => { editingSound = ''; document.getElementById('inputSoundFile').value = ''; });
  document.getElementById('btnTestSound').addEventListener('click', () => window.api.testSound(editingSound, editingUnit).catch(e => window.notify(String(e))));
  document.getElementById('btnCancelSound').addEventListener('click', () => hideModal('soundModal'));
  document.getElementById('pcMuteGrid').addEventListener('click', e => {
    const btn = e.target.closest('button[data-minutes]'); if (!btn) return;
    window.api.muteChoose(Number(btn.dataset.minutes)).catch(err => window.notify(String(err)));
  });
  document.getElementById('btnPcUnmute').addEventListener('click', () => window.api.unmuteNow().catch(e => window.notify(String(e))));
  document.getElementById('btnPcCancelTimer').addEventListener('click', () => window.api.muteCancel().catch(e => window.notify(String(e))));
  document.getElementById('btnSaveSound').addEventListener('click', saveSoundModal);
  document.getElementById('btnTestSound1').addEventListener('click', () => window.api.testSound(settings.units[0].sound_file || '', 1).catch(e => window.notify(String(e))));
  document.getElementById('btnTestSound2').addEventListener('click', () => window.api.testSound(settings.units[1].sound_file || '', 2).catch(e => window.notify(String(e))));
  document.querySelectorAll('.chk-mute').forEach(chk => chk.addEventListener('change', async () => {
    try { await window.api.saveSettings({ units: { [chk.dataset.unit]: { muted: chk.checked } } }); } catch (e) { chk.checked = !chk.checked; window.notify(String(e)); }
  }));
  document.querySelectorAll('.btn-clear-logs').forEach(btn => btn.addEventListener('click', () => window.api.clearLogs(Number(btn.dataset.unit)).catch(e => window.notify(String(e)))));
  document.getElementById('cancelClient').addEventListener('click', () => hideModal('clientModal'));
  document.getElementById('saveClient').addEventListener('click', async () => {
    try { await window.api.saveSettings(clientPatch()); hideModal('clientModal'); } catch (e) { window.notify(String(e)); }
  });
  document.getElementById('btnImportSettings').addEventListener('click', async () => {
    try { const imported = await window.api.importSettings(); if (imported) { window.notify('설정을 가져와 적용했습니다'); fillClientSettings(); } } catch (e) { window.notify(String(e)); }
  });
  document.getElementById('btnExportSettings').addEventListener('click', async () => {
    try { if (await window.api.exportSettings(clientPatch())) window.notify('설정을 내보냈습니다'); } catch (e) { window.notify(String(e)); }
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.classList.remove('show'); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show')); });
  document.getElementById('btnMinimize').addEventListener('click', () => window.api.windowMinimize());
  document.getElementById('btnMaximize').addEventListener('click', async () => { await window.api.windowMaximize(); setMaximizeIcon(await window.api.windowIsMaximized()); });
  document.getElementById('btnClose').addEventListener('click', () => window.api.windowClose());
}

function setMaximizeIcon(isMaximized) {
  const btn = document.getElementById('btnMaximize');
  btn.title = isMaximized ? '이전 크기로' : '최대화';
  btn.innerHTML = isMaximized
    ? '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="7" height="7" x="1.5" y="3.5"/><path fill="none" stroke="currentColor" stroke-width="1" d="M3.5 3.5v-2h7v7h-2"/></svg>'
    : '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5"/></svg>';
}

// --- Snapshot ---
export function syncSnapshot(snap) {
  latestSnapshot = snap;
  settings = snap.settings;
  params = snap.params;
  isRunning = snap.running;
  btnStart.disabled = isRunning;
  btnStop.disabled = !isRunning;
  for (const unit of [1, 2]) {
    const live = snap.units[unit - 1];
    renderHeader(unit, live);
    renderReadings(unit, live);
    renderLogs(unit, live.logs || []);
    const chk = document.querySelector(`.chk-mute[data-unit="${unit}"]`);
    if (chk && document.activeElement !== chk) chk.checked = !!settings.units[unit - 1].muted;
  }
  document.getElementById('hostName').textContent = snap.host + ' · v' + snap.version;
  updateStatusBar(snap);
  if (document.getElementById('soundModal').classList.contains('show')) renderPcMute(snap);
}

function formatTime(at, date = false) { return at ? new Date(at).toLocaleString('ko-KR', { ...(date ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'; }
function escapeHtml(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttr(str) { return escapeHtml(str).replace(/'/g, '&#39;'); }
function isValidIp(ip) { return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) && ip.split('.').every(n => Number(n) <= 255); }

export { init };
