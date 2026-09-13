// State
let settings = {};
let isRunning = false;
let failLogs = [];
let currentView = 'table';
let npcapAvailable = false;
let ipToIndex = {};

// DOM Elements
const targetTableBody = document.getElementById('targetTableBody');
const logTableBody = document.getElementById('logTableBody');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnClearLogs = document.getElementById('btnClearLogs');
const chkMute = document.getElementById('chkMute');
let latestSnapshot = null;
let lastConfigKey = "";
let lastLogKey = "";

// --- Initialize ---
async function init() {
  syncSnapshot(await window.api.snapshot());
  npcapAvailable = await window.api.isNpcapAvailable();
  updateNpcapIndicator();
}

function buildIpMap() {
  ipToIndex = {};
  const targets = settings.targets || [];
  targets.forEach((t, i) => {
    if (t.address) ipToIndex[t.address] = i;
  });
  if (window.view2d) window.view2d.setIpMap(ipToIndex);
}

function updateNpcapIndicator() {
  const el = document.getElementById('npcapStatus');
  if (!el) return;
  if (npcapAvailable) {
    el.textContent = 'PCAP';
    el.className = 'npcap-badge active';
    el.title = 'Npcap 패킷 캡처 활성';
  } else {
    el.textContent = 'PCAP';
    el.className = 'npcap-badge';
    el.title = 'Npcap 미설치 - 트래픽 시각화 비활성';
  }
}

// --- Target Table ---
function renderTargetTable() {
  targetTableBody.innerHTML = '';
  (settings.targets || []).forEach((target, index) => {
    const row = document.createElement('tr');
    row.id = 'target-' + index;
    row.className = target.enabled ? '' : 'status-disabled';
    row.innerHTML = '<td><span class="target-dot"></span>' + escapeHtml(target.name) + '</td><td class="mono">' + escapeHtml(target.address) + '</td><td>' + (target.enabled ? (isRunning ? '대기' : '정지') : '비활성') + '</td><td>—</td><td>—</td><td><canvas width="120" height="28" aria-label="최근 응답 이력"></canvas></td><td>—</td>';
    targetTableBody.appendChild(row);
  });
  if (!settings.targets?.length) targetTableBody.innerHTML = '<tr><td colspan="7" class="empty-state"><strong>등록된 감시 대상이 없습니다</strong><p>‘감시대상’에서 장비를 추가하거나 기존 설정을 가져오세요.</p></td></tr>';
}

function updateTargetCount() {
  const targets = settings.targets || [];
  const activeCount = targets.filter(t => t.name && t.address && t.enabled).length;
  const totalCount = targets.filter(t => t.name && t.address).length;
  const el = document.getElementById('targetCount');
  if (el) el.textContent = `${activeCount}/${totalCount}개 활성`;
}

function updateTargetRow(data) {
  const tr = document.getElementById('target-' + data.index);
  if (!tr || tr.classList.contains('status-disabled')) return;
  tr.className = data.status === '장애' ? 'status-failed' : data.status === '성공' ? 'status-healthy' : 'status-pending';
  tr.children[2].textContent = data.status === '성공' ? '정상' : data.status;
  tr.children[3].textContent = data.rttMs == null ? '—' : data.rttMs + ' ms';
  tr.children[4].textContent = data.sent ? (data.lost / data.sent * 100).toFixed(1) + '%' : '—';
  tr.children[6].textContent = formatTime(data.at);
  const canvas = tr.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 120, 28);
  const history = data.history || [];
  const max = Math.max(10, ...history.filter(n => n != null));
  history.forEach((n, i) => { ctx.fillStyle = n == null ? '#ef4444' : '#34d399'; const h = n == null ? 25 : Math.max(3, n / max * 25); ctx.fillRect(i * 2, 28 - h, 1.3, h); });
}

// --- Failure Log ---
function addLogEntry(data) {
  const tr = document.createElement('tr');
  tr.className = data.status === '정상 복구' ? 'log-recovery' : 'log-error';
  tr.innerHTML = `
    <td>${escapeHtml(formatTime(data.at, true))}</td>
    <td>${escapeHtml(data.name)}</td>
    <td>${escapeHtml(data.address)}</td>
    <td>${escapeHtml(data.status)}</td>
  `;
  logTableBody.appendChild(tr);
  failLogs.push(data);

  // Keep max 100
  if (failLogs.length > 100) {
    failLogs.shift();
    if (logTableBody.firstElementChild) {
      logTableBody.removeChild(logTableBody.firstElementChild);
    }
  }

  // Auto-scroll to bottom
  const container = logTableBody.closest('.table-container');
  if (container) container.scrollTop = container.scrollHeight;
}

// --- Status Bar ---
function updateStatusBar() {
  const indicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const statusInterval = document.getElementById('statusInterval');
  const statusTime = document.getElementById('statusTime');

  if (indicator) {
    indicator.className = 'status-indicator ' + (isRunning ? 'running' : '');
  }
  if (statusText) {
    statusText.textContent = isRunning ? '감시 중' : '대기 중';
  }
  if (statusInterval) {
    statusInterval.textContent = `주기: ${settings.ping_interval || 1}초`;
  }
}

// Update clock every second
function updateClock() {
  const el = document.getElementById('statusTime');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('ko-KR', { hour12: false });
  }
}
updateClock();
setInterval(updateClock, 1000);

// --- Controls ---
btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  try { await window.api.startPinging(); syncSnapshot(await window.api.snapshot()); }
  catch (e) { window.notify(String(e)); btnStart.disabled = false; }
});
btnStop.addEventListener('click', async () => {
  try { await window.api.stopPinging(); syncSnapshot(await window.api.snapshot()); }
  catch (e) { window.notify(String(e)); }
});
btnClearLogs.addEventListener('click', async () => {
  try { await window.api.clearLogs(); syncSnapshot(await window.api.snapshot()); }
  catch (e) { window.notify(String(e)); }
});
chkMute.addEventListener('change', async () => {
  try { settings = await window.api.saveSettings({ mute_state: chkMute.checked }); }
  catch (e) { chkMute.checked = settings.mute_state; window.notify(String(e)); }
});

// --- IPC Events ---
// Remove old listeners to prevent accumulation on renderer reload
['ping-result', 'failure-log', 'play-sound', 'traffic-stats',
 'internode-stats', 'discovered-nodes', 'asterix-flows', 'capture-error',
 'window-maximized', 'window-unmaximized'].forEach(ch => window.api.removeAllListeners(ch));

window.api.onPingResult((data) => {
  updateTargetRow(data);
  if (currentView === '2d' && window.view2d && window.view2d.isActive()) {
    window.view2d.updateNodeStatus(data.index, data.status, formatTime(data.at));
  }
});

// Persisted snapshots also restore history after a WebView reload.

window.api.onTrafficStats(() => {});

window.api.onInterNodeStats((data) => {
  if (currentView === '2d' && window.view2d && window.view2d.isActive()) window.view2d.handleInterNodeStats(data);
});

window.api.onDiscoveredNodes((nodes) => {
  if (currentView === '2d' && window.view2d && window.view2d.isActive()) window.view2d.handleDiscoveredNodes(nodes);
});

window.api.onAsterixFlows(() => {});

window.api.onCaptureError((msg) => {
  console.error('패킷 캡처 오류:', msg);
});



// --- Modals ---
function showModal(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  // Close any other open modals first
  document.querySelectorAll('.modal-overlay.show').forEach(m => {
    if (m.id !== id) m.classList.remove('show');
  });
  // If already open, don't re-initialize
  if (el.classList.contains('show')) return false;
  el.classList.add('show');
  return true;
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal-overlay.show');
    if (!open) return;
    // Topology modal needs special cleanup
    if (open.id === 'topoModal' && typeof closeTopoEditor === 'function') {
      closeTopoEditor();
    } else {
      hideModal(open.id);
    }
  }
});

// --- Target Settings ---
document.getElementById('menuTargets').addEventListener('click', () => {
  if (!showModal('targetModal')) return;
  const body = document.getElementById('targetSettingsBody');
  body.innerHTML = '';
  const typeOptions = [
    { value: 'pc', label: 'PC' },
    { value: 'router', label: '라우터' },
    { value: 'switch', label: '스위치' },
    { value: 'server', label: '서버' }
  ];
  for (let i = 0; i < 20; i++) {
    const target = (settings.targets && settings.targets[i]) || { name: '', address: '', enabled: true, type: 'pc' };
    const tr = document.createElement('tr');
    const typeSelHtml = typeOptions.map(o =>
      `<option value="${o.value}"${(target.type || 'pc') === o.value ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    tr.innerHTML = `
      <td><input type="checkbox" class="ts-enabled" ${target.enabled !== false ? 'checked' : ''}></td>
      <td><input type="text" class="ts-name" value="${escapeAttr(target.name || '')}"></td>
      <td><input type="text" class="ts-address" value="${escapeAttr(target.address || '')}"></td>
      <td><select class="ts-type">${typeSelHtml}</select></td>
    `;
    body.appendChild(tr);
  }
});

document.getElementById('btnSaveTargets').addEventListener('click', async () => {
  const rows = document.querySelectorAll('#targetSettingsBody tr');
  const targets = [];
  rows.forEach(row => {
    const name = row.querySelector('.ts-name').value.trim();
    const address = row.querySelector('.ts-address').value.trim();
    const enabled = row.querySelector('.ts-enabled').checked;
    const type = row.querySelector('.ts-type').value || 'pc';
    if (name && address) {
      targets.push({ name, address, enabled, type });
    }
  });
  // Validate addresses
  const invalidTarget = targets.find(t => !/^[a-zA-Z0-9]+([.\-][a-zA-Z0-9]+)*$/.test(t.address));
  if (invalidTarget) {
    alert(`유효하지 않은 주소: ${invalidTarget.address}\nIP 주소 또는 호스트명을 입력하세요.`);
    return;
  }
  // Check for duplicate addresses
  const addresses = targets.map(t => t.address);
  const dupes = addresses.filter((a, i) => addresses.indexOf(a) !== i);
  if (dupes.length > 0) {
    alert(`중복된 주소가 있습니다: ${[...new Set(dupes)].join(', ')}\n중복 주소의 ping 결과가 정확하지 않을 수 있습니다.`);
  }
  try {
    const saved = await window.api.saveSettings({ targets });
    if (saved) settings = saved;
  } catch (e) {
    console.error('Failed to save targets:', e);
    window.notify(String(e));
    return;
  }
  buildIpMap();
  renderTargetTable();
  updateTargetCount();
  if (currentView === '2d' && window.view2d && window.view2d.isActive()) {
    window.view2d.setTargets(settings.targets || [], ipToIndex);
  }
  hideModal('targetModal');

});

document.getElementById('btnCancelTargets').addEventListener('click', () => hideModal('targetModal'));

// --- Interval Settings ---
document.getElementById('menuInterval').addEventListener('click', () => {
  if (!showModal('intervalModal')) return;
  document.getElementById('inputInterval').value = settings.ping_interval || 1;
  document.getElementById('inputTimeout').value = settings.timeout_ms;
  document.getElementById('inputThreshold').value = settings.failure_threshold;
});

document.getElementById('btnSaveInterval').addEventListener('click', async () => {
  const raw = document.getElementById('inputInterval').value.trim();
  const val = parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || isNaN(val) || val < 1 || val > 3600) {
    alert('주기는 1초 이상 3600초(1시간) 이하의 정수여야 합니다.');
    return;
  }
  try {
    const saved = await window.api.saveSettings({ ping_interval: val, timeout_ms: Number(document.getElementById('inputTimeout').value), failure_threshold: Number(document.getElementById('inputThreshold').value) });
    if (saved) settings = saved;
  } catch (e) {
    console.error('Failed to save interval:', e);
    window.notify(String(e));
    return;
  }
  updateStatusBar();
  hideModal('intervalModal');

});

document.getElementById('btnCancelInterval').addEventListener('click', () => hideModal('intervalModal'));

// --- UDP Settings ---
document.getElementById('menuUdp').addEventListener('click', () => {
  if (!showModal('udpModal')) return;
  document.getElementById('chkUdpEnabled').checked = settings.udp_enabled || false;
  document.getElementById('inputUdpIp').value = settings.udp_ip || '';
  document.getElementById('inputUdpPort').value = settings.udp_port || '';
  document.getElementById('inputUdpMessage').value = settings.udp_message || '';
  document.getElementById('inputUdpNoFailure').value = settings.udp_no_failure_message || '';
});

document.getElementById('btnSaveUdp').addEventListener('click', async () => {
  const ip = document.getElementById('inputUdpIp').value.trim();
  const port = document.getElementById('inputUdpPort').value.trim();
  const udpEnabled = document.getElementById('chkUdpEnabled').checked;

  // When UDP enabled, require both IP and port
  if (udpEnabled) {
    if (!ip) {
      alert('UDP 활성화 시 IP 주소를 입력하세요.');
      return;
    }
    if (!port) {
      alert('UDP 활성화 시 포트를 입력하세요.');
      return;
    }
  }

  // Validate IP
  if (ip && !isValidIp(ip)) {
    alert('유효한 IP 주소를 입력하세요.');
    return;
  }

  // Validate port
  if (port && !/^\d+$/.test(port)) {
    alert('포트 번호는 숫자만 입력 가능합니다.');
    return;
  }
  const portNum = parseInt(port, 10);
  if (port && (isNaN(portNum) || portNum < 1 || portNum > 65535)) {
    alert('포트 번호는 1에서 65535 사이여야 합니다.');
    return;
  }

  const udpSettings = {
    udp_enabled: udpEnabled,
    udp_ip: ip,
    udp_port: port ? String(parseInt(port, 10)) : '',
    udp_message: document.getElementById('inputUdpMessage').value,
    udp_no_failure_message: document.getElementById('inputUdpNoFailure').value
  };
  try {
    const saved = await window.api.saveSettings(udpSettings);
    if (saved) settings = saved;
  } catch (e) {
    console.error('Failed to save UDP settings:', e);
    window.notify(String(e));
    return;
  }
  hideModal('udpModal');
});

document.getElementById('btnCancelUdp').addEventListener('click', () => hideModal('udpModal'));

// --- Sound Settings ---
document.getElementById('menuSound').addEventListener('click', () => {
  if (!showModal('soundModal')) return;
  document.getElementById('chkSoundEnabled').checked = settings.sound_enabled !== false;
  document.getElementById('inputSoundFile').value = settings.sound_file || '';
});

document.getElementById('btnBrowseSound').addEventListener('click', async () => {
  try {
    const filePath = await window.api.browseSoundFile();
    if (filePath) {
      document.getElementById('inputSoundFile').value = filePath;
    }
  } catch (e) {
    console.error('Failed to browse sound file:', e);
  }
});

document.getElementById('btnTestSound').addEventListener('click', async () => {
  try { await window.api.testSound(document.getElementById('inputSoundFile').value); }
  catch (e) { window.notify(String(e)); }
});

document.getElementById('btnSaveSound').addEventListener('click', async () => {
  const soundSettings = {
    sound_enabled: document.getElementById('chkSoundEnabled').checked,
    sound_file: document.getElementById('inputSoundFile').value
  };
  try {
    const saved = await window.api.saveSettings(soundSettings);
    if (saved) settings = saved;
  } catch (e) {
    console.error('Failed to save sound settings:', e);
    window.notify(String(e));
    return;
  }
  hideModal('soundModal');
});

document.getElementById('btnCancelSound').addEventListener('click', () => hideModal('soundModal'));

// --- Capture Settings ---
document.getElementById('menuCapture').addEventListener('click', async () => {
  if (!showModal('captureModal')) return;
  const listEl = document.getElementById('captureDeviceList');
  listEl.innerHTML = '';

  // Populate network interfaces
  let interfaces = [];
  try {
    interfaces = await window.api.getNetworkInterfaces();
  } catch (e) {
    listEl.textContent = String(e);
  }

  // Build enabled device map from settings
  const enabledMap = {};
  const captureDevices = settings.capture_devices || [];
  for (const cd of captureDevices) {
    if (cd && cd.name) enabledMap[cd.name] = cd.enabled !== false;
  }
  // Legacy single device support
  if (captureDevices.length === 0 && settings.capture_device) {
    enabledMap[settings.capture_device] = true;
  }

  for (const iface of interfaces) {
    const item = document.createElement('label');
    item.className = 'capture-device-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.deviceName = iface.name;
    cb.checked = captureDevices.length === 0 || enabledMap[iface.name] === true;
    const info = document.createElement('div');
    info.className = 'cap-dev-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'cap-dev-name';
    nameEl.textContent = iface.description || iface.name;
    const addrsEl = document.createElement('div');
    addrsEl.className = 'cap-dev-addrs';
    addrsEl.textContent = iface.addresses.join(', ');
    info.appendChild(nameEl);
    info.appendChild(addrsEl);
    item.appendChild(cb);
    item.appendChild(info);
    listEl.appendChild(item);
  }
});

document.getElementById('btnSaveCapture').addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('#captureDeviceList input[type="checkbox"]');
  const captureDevices = [];
  checkboxes.forEach(cb => {
    captureDevices.push({ name: cb.dataset.deviceName, enabled: cb.checked });
  });
  try {
    const saved = await window.api.saveCaptureSettings({ capture_devices: captureDevices });
    if (saved) settings = saved;
  } catch (e) {
    console.error('Failed to save capture settings:', e);
    window.notify(String(e));
    return;
  }
  hideModal('captureModal');
});

document.getElementById('btnCancelCapture').addEventListener('click', () => hideModal('captureModal'));

// --- Topology Editor ---
let topoEditorInited = false;
let topoResizeObs = null;

document.getElementById('menuTopo').addEventListener('click', () => {
  if (!showModal('topoModal')) return;

  // Populate target dropdown
  const sel = document.getElementById('topoPropTarget');
  sel.innerHTML = '<option value="">— 연결 안함 —</option>';
  (settings.targets || []).forEach((t, i) => {
    if (t.name && t.address) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${t.name} (${t.address})`;
      sel.appendChild(opt);
    }
  });

  // Init canvas editor (re-init each time since destroy() tears it down)
  const canvasEl = document.getElementById('topoCanvas');
  try {
    if (!topoEditorInited) {
      window.topoEditor.init(canvasEl, onTopoSelect);
      topoEditorInited = true;
    }
    window.topoEditor.load(settings.topology, settings.targets || []);
    window.topoEditor.setMode('select'); // Reset mode + toolbar
  } catch (e) {
    console.error('Failed to initialize topology editor:', e);
    hideModal('topoModal');
    return;
  }

  // Defer resize so the modal is rendered
  requestAnimationFrame(() => {
    if (!document.getElementById('topoModal').classList.contains('show')) return;
    window.topoEditor.resize();
    window.topoEditor.render();
  });

  // ResizeObserver for window resize while modal is open
  if (topoResizeObs) topoResizeObs.disconnect();
  const wrapEl = document.querySelector('.topo-canvas-wrap');
  if (wrapEl) {
    topoResizeObs = new ResizeObserver(() => {
      if (document.getElementById('topoModal').classList.contains('show') && topoEditorInited) {
        window.topoEditor.resize();
      }
    });
    topoResizeObs.observe(wrapEl);
  }

  // Clear property panel
  onTopoSelect(null);
});

// Toolbar mode buttons
document.querySelectorAll('.topo-tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const m = btn.dataset.mode;
    if (m && topoEditorInited) {
      window.topoEditor.setMode(m);
    }
  });
});

function onTopoSelect(dev) {
  const nameInput = document.getElementById('topoPropName');
  const ipInput = document.getElementById('topoPropIp');
  const typeSel = document.getElementById('topoPropType');
  const targetSel = document.getElementById('topoPropTarget');
  const propsEl = document.getElementById('topoProps');

  if (!dev) {
    nameInput.value = '';
    ipInput.value = '';
    typeSel.value = 'pc';
    targetSel.value = '';
    nameInput.disabled = true;
    ipInput.disabled = true;
    typeSel.disabled = true;
    targetSel.disabled = true;
    propsEl.style.opacity = '0.4';
    propsEl.dataset.devId = '';
    return;
  }

  const isHub = dev.type === 'hub_center';
  nameInput.disabled = false;
  ipInput.disabled = false;
  typeSel.disabled = isHub;
  targetSel.disabled = false;
  propsEl.style.opacity = '1';

  nameInput.value = dev.name || '';
  ipInput.value = dev.ip || '';
  typeSel.value = isHub ? 'pc' : (dev.type || 'pc');
  targetSel.value = dev.target_index !== undefined && dev.target_index !== null ? dev.target_index : '';

  // Store selected device id for updates
  propsEl.dataset.devId = dev.id;
}

// Property panel live updates
document.getElementById('topoPropName').addEventListener('input', (e) => {
  const id = document.getElementById('topoProps').dataset.devId;
  if (id && topoEditorInited) window.topoEditor.updateDevice(id, { name: e.target.value });
});

document.getElementById('topoPropIp').addEventListener('input', (e) => {
  const id = document.getElementById('topoProps').dataset.devId;
  if (id && topoEditorInited) window.topoEditor.updateDevice(id, { ip: e.target.value });
});

document.getElementById('topoPropType').addEventListener('change', (e) => {
  const id = document.getElementById('topoProps').dataset.devId;
  if (id && topoEditorInited) window.topoEditor.updateDevice(id, { type: e.target.value });
});

document.getElementById('topoPropTarget').addEventListener('change', (e) => {
  const id = document.getElementById('topoProps').dataset.devId;
  if (!id || !topoEditorInited) return;
  const val = e.target.value;
  const idx = val !== '' ? parseInt(val, 10) : undefined;
  const targets = settings.targets || [];
  if (idx !== undefined && (isNaN(idx) || idx < 0 || idx >= targets.length)) return;
  const t = idx !== undefined ? targets[idx] : null;
  const updateProps = {
    target_index: idx,
    ip: t ? t.address : document.getElementById('topoPropIp').value,
    name: t ? t.name : document.getElementById('topoPropName').value
  };
  if (t && t.type) updateProps.type = t.type;
  window.topoEditor.updateDevice(id, updateProps);
  if (t) {
    document.getElementById('topoPropIp').value = t.address;
    document.getElementById('topoPropName').value = t.name;
    if (t.type) document.getElementById('topoPropType').value = t.type;
  }
});

function closeTopoEditor() {
  if (topoResizeObs) { topoResizeObs.disconnect(); topoResizeObs = null; }
  if (topoEditorInited) {
    try { window.topoEditor.destroy(); } catch (e) { console.error('Topo editor destroy error:', e); }
    topoEditorInited = false;
  }
  hideModal('topoModal');
}

document.getElementById('btnSaveTopo').addEventListener('click', async () => {
  if (!topoEditorInited) { closeTopoEditor(); return; }
  const topo = window.topoEditor.save();
  try {
    const saved = await window.api.saveSettings({ topology: topo });
    if (saved) settings = saved;
  } catch (e) {
    console.error('Failed to save topology:', e);
    window.notify(String(e));
    return;
  }
  closeTopoEditor();
  // Apply to 2D view (setTopology auto-rebuilds if targets exist)
  if (currentView === '2d' && window.view2d && window.view2d.isActive()) {
    window.view2d.setTopology(topo);
    window.view2d.setTargets(settings.targets || [], ipToIndex);
  }
});

document.getElementById('btnCancelTopo').addEventListener('click', () => closeTopoEditor());

// --- 2D Topology View ---
function switchView(view) {
  currentView = view;
  const tableContainer = document.querySelector('.panel-left .table-container');
  const view2dEl = document.getElementById('view2d');

  if (view === '2d') {
    tableContainer.style.display = 'none';
    view2dEl.classList.add('active');
    if (window.view2d) {
      window.view2d.init();
      if (settings.topology && window.view2d.setTopology) {
        window.view2d.setTopology(settings.topology);
      }
      window.view2d.setTargets(settings.targets || [], ipToIndex);
    }
  } else {
    tableContainer.style.display = '';
    view2dEl.classList.remove('active');
    if (window.view2d && window.view2d.isActive()) window.view2d.dispose();
  }

  if (view === '2d' && latestSnapshot) for (const r of latestSnapshot.results) window.view2d.updateNodeStatus(r.index, r.status, formatTime(r.at));
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});


// --- Utility ---
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isValidIp(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === p;
  });
}

// --- Window Controls ---
document.getElementById('btnMinimize').addEventListener('click', () => {
  window.api.windowMinimize().catch(() => {});
});

document.getElementById('btnMaximize').addEventListener('click', () => {
  window.api.windowMaximize().catch(() => {});
});

document.getElementById('btnClose').addEventListener('click', () => {
  window.api.windowClose().catch(() => {});
});

function setMaximizeIcon(isMaximized) {
  const btnMaximize = document.getElementById('btnMaximize');
  if (!btnMaximize) return;
  if (isMaximized) {
    btnMaximize.innerHTML = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="7" height="7" x="1.5" y="3.5"/><polyline fill="none" stroke="currentColor" stroke-width="1" points="3.5,3.5 3.5,1.5 10.5,1.5 10.5,8.5 8.5,8.5"/></svg>';
    btnMaximize.title = '이전 크기로 복원';
  } else {
    btnMaximize.innerHTML = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5"/></svg>';
    btnMaximize.title = '최대화';
  }
}

window.api.onWindowMaximized(() => setMaximizeIcon(true));
window.api.onWindowUnmaximized(() => setMaximizeIcon(false));
window.api.windowIsMaximized().then(isMax => setMaximizeIcon(isMax)).catch(() => {});

// Double-click titlebar to maximize/restore
document.getElementById('titlebar').addEventListener('dblclick', (e) => {
  if (e.target.closest('.titlebar-btn')) return;
  window.api.windowMaximize().catch(() => {});
});

export function syncSnapshot(snap) {
  latestSnapshot = snap;
  const configKey = JSON.stringify(snap.settings) + snap.running;
  settings = snap.settings; isRunning = snap.running;
  if (lastConfigKey !== configKey) {
    lastConfigKey = configKey; buildIpMap(); renderTargetTable(); updateTargetCount(); updateStatusBar();
    chkMute.checked = settings.mute_state;
    if (currentView === '2d' && window.view2d?.isActive()) {
      window.view2d.setTopology(settings.topology); window.view2d.setTargets(settings.targets, ipToIndex);
    }
  }
  btnStart.disabled = isRunning; btnStop.disabled = !isRunning;
  for (const result of snap.results) { updateTargetRow(result); if (window.view2d?.isActive()) window.view2d.updateNodeStatus(result.index, result.status, formatTime(result.at)); }
  const logKey = JSON.stringify(snap.logs);
  if (logKey !== lastLogKey) { lastLogKey = logKey; failLogs = []; logTableBody.innerHTML = ''; snap.logs.forEach(addLogEntry); }
  if (!snap.logs.length) logTableBody.innerHTML = '<tr><td colspan="4" class="empty-state"><strong>아직 장애 이력이 없습니다</strong><p>장애 발생과 정상 복구 시 이곳에 기록됩니다.</p></td></tr>';
  const active = settings.targets.filter(t => t.enabled).length;
  const healthy = snap.results.filter(r => r.status === '성공').length;
  const failed = snap.results.filter(r => r.status === '장애').length;
  const rtts = snap.results.filter(r => r.rttMs != null).map(r => r.rttMs);
  setText('metricTotal', active); setText('metricHealthy', healthy); setText('metricFailed', failed); setText('metricPending', '대기 ' + (active - healthy - failed) + '개');
  setText('metricRtt', rtts.length ? (rtts.reduce((a,b) => a+b, 0) / rtts.length).toFixed(1) : '—');
  setText('overviewTitle', !isRunning ? '감시가 정지되어 있습니다' : failed ? failed + '개 장비의 연결을 확인하세요' : healthy === active && active ? '모든 장비가 정상입니다' : '네트워크 응답을 확인하고 있습니다');
  setText('overviewDescription', !active ? '감시대상을 추가하거나 기존 PingTester 설정을 가져오세요.' : 'ICMP ping · ' + settings.ping_interval + '초 주기 · 연속 ' + settings.failure_threshold + '회 실패 시 장애 판정');
  setText('hostName', snap.host + ' · v' + snap.version);
  setText('connectionTarget', settings.udp_enabled ? settings.udp_ip + ':' + settings.udp_port : '서버 자동 연결 대기');
  setText('connectionStatus', snap.sendStatus);
  setText('lastSent', settings.udp_enabled && snap.lastSentAt ? '최근 전송 ' + formatTime(snap.lastSentAt) : '시설 등록 → 자동 탐지 (PC)');
  document.getElementById('connectionDot').classList.toggle('active', settings.udp_enabled && isRunning && snap.lastSentAt != null && Date.now() - snap.lastSentAt < settings.interval_ms * 2);
  setText('clientDiscovery', snap.discoveryStatus);
  document.getElementById('npcapStatus').title = snap.captureStatus;
}
function setText(id, value) { document.getElementById(id).textContent = value; }
function formatTime(at, date = false) { return at ? new Date(at).toLocaleString('ko-KR', { ...(date ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—'; }

document.getElementById('menuClient').addEventListener('click', () => {
  document.getElementById('clientName').value = settings.name;
  document.getElementById('clientAutostart').checked = settings.autostart;
  document.getElementById('clientAutoMonitor').checked = settings.auto_monitor;
  showModal('clientModal');
});
document.getElementById('cancelClient').addEventListener('click', () => hideModal('clientModal'));
document.getElementById('saveClient').addEventListener('click', async () => {
  try { await window.api.saveSettings({ name: document.getElementById('clientName').value.trim(), autostart: document.getElementById('clientAutostart').checked, auto_monitor: document.getElementById('clientAutoMonitor').checked }); hideModal('clientModal'); window.notify('클라이언트 설정을 저장했습니다'); }
  catch (e) { window.notify(String(e)); }
});
document.getElementById('menuImport').addEventListener('click', async () => {
  try { const result = await window.api.importSettings(); if (result) { syncSnapshot(await window.api.snapshot()); window.notify('기존 감시 대상과 토폴로지를 가져왔습니다'); } }
  catch (e) { window.notify(String(e)); }
});
export { init };
