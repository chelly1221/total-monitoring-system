/* TMS Portable — TV 4K dashboard.
 * Pixel-close port of dashboard / temperature / UPS / alarms pages.
 * ES2015-safe (Chromium 68+). No optional chaining, no nullish coalescing. */
(function () {
  'use strict';

  /* ============================================================
   *  Constants
   * ============================================================ */
  var SENSOR_COLORS = ['#f87171','#4ade80','#fbbf24','#a78bfa','#22d3ee','#fb923c','#f472b6','#84cc16'];
  var UPS_COLORS = SENSOR_COLORS;
  var DEFAULT_CHART_METRIC_NAMES = ['입력전압','입력전류','출력전압','출력전류','주파수','배터리잔량'];
  var UPS_BAR_RANGES = {
    inputVoltage: [180, 240], outputVoltage: [180, 240],
    inputCurrent: [0, 100], outputCurrent: [0, 100],
    inputFrequency: [55, 65], outputFrequency: [55, 65],
    load: [0, 100], batteryVoltage: [0, 60], batteryRemaining: [0, 100], temperature: [0, 60],
  };
  var UPS_FIXED_Y = { '주파수': [59.5, 60.5] };
  /* TV charts are kept fresh primarily via WebSocket metric appends (see
   * applyMetricUpdate → appendHistoryPoint). The full history refresh is a
   * safety net for missed updates; 5 min is enough given 24h windows. */
  var HISTORY_REFRESH_MS = 5 * 60 * 1000;
  var HISTORY_APPEND_THROTTLE_MS = 10 * 1000;
  var RECONNECT_DELAY_MS = 3000;
  var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.hostname + ':7778';
  var C = { grid: '#333333', axis: '#a1a1aa', fg: '#fafafa', dim: '#b4b4b4' };

  /* Lucide-like SVG icons */
  var SVG = {
    alertTriangle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    alertCircle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    checkCircle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    activity: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    volume2: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    doorClosed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/><path d="M14 12v.01"/></svg>',
    settings: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    maximize2: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    minimize2: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
  };

  /* ============================================================
   *  State
   * ============================================================ */
  var state = {
    systemsById: {},
    alarms: [],
    connected: false,
    metricHistory: { sensor: [], ups: [] },
    charts: {},
    featureFlags: { temperatureEnabled: true, upsEnabled: true, gateEnabled: true },
    filter: {
      typeFilter: 'all',   /* all | critical | warning | hot | cold | dry | humid */
      selectedSystems: null, /* Object<id,true> or null (= all) */
      dateFrom: '',
      timeFrom: '00:00',
      dateTo: '',
      timeTo: '23:59'
    },
    filterInited: false
  };

  var IS_4K = (window.innerWidth || 0) > 2999;

  /* ============================================================
   *  DOM helpers
   * ============================================================ */
  function $(id) { return document.getElementById(id); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setText(id, text) { var n = $(id); if (n) n.textContent = text; }
  function setHTML(node, html) { if (node) node.innerHTML = html; }
  function parseConfig(s) {
    if (!s) return null;
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  function getSystems(type) {
    var out = [];
    for (var id in state.systemsById) {
      if (!Object.prototype.hasOwnProperty.call(state.systemsById, id)) continue;
      var s = state.systemsById[id];
      if (s.type === type || (type === 'equipment' && s.type === '장비상태')) out.push(s);
    }
    return out;
  }
  function findMetric(sys, name) {
    if (!sys || !sys.metrics) return null;
    for (var i = 0; i < sys.metrics.length; i++) {
      if (sys.metrics[i].name === name) return sys.metrics[i];
    }
    return null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function formatNum(v) {
    if (v === null || v === undefined) return '—';
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 100) return v.toFixed(1);
    if (Math.abs(v) >= 10) return v.toFixed(2);
    return v.toFixed(3);
  }
  function formatTimeHM(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  /* ============================================================
   *  HTTP
   * ============================================================ */
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function reloadSystems() {
    return fetchJSON('/api/systems').then(function (systems) {
      var map = {};
      for (var i = 0; i < systems.length; i++) map[systems[i].id] = systems[i];
      state.systemsById = map;
      renderTopbar();
      renderEquipment();
      renderSensors();
      renderUps();
    }).catch(function (e) { console.error('reloadSystems', e); });
  }

  function reloadAlarms() {
    return fetchJSON('/api/alarms?limit=100').then(function (alarms) {
      state.alarms = alarms;
      renderEquipment();
      renderAlarms();
    }).catch(function (e) { console.error('reloadAlarms', e); });
  }

  function reloadFeatureFlags() {
    return fetchJSON('/api/settings').then(function (settings) {
      if (!settings || typeof settings !== 'object') return;
      state.featureFlags = {
        temperatureEnabled: settings.temperatureEnabled !== 'false',
        upsEnabled: settings.upsEnabled !== 'false',
        gateEnabled: settings.gateEnabled !== 'false'
      };
      /* Reset type filter if a hidden temperature chip was active */
      if (!state.featureFlags.temperatureEnabled) {
        var t = state.filter.typeFilter;
        if (t === 'hot' || t === 'cold' || t === 'dry' || t === 'humid') state.filter.typeFilter = 'all';
      }
      renderAlarms();
    }).catch(function (e) { console.error('reloadFeatureFlags', e); });
  }

  function reloadHistory() {
    return Promise.all([
      fetchJSON('/api/metrics/history?type=sensor&hours=24').then(function (d) {
        state.metricHistory.sensor = d; renderSensorCharts();
      }).catch(function (e) { console.error('sensor history', e); }),
      fetchJSON('/api/metrics/history?type=ups&hours=24').then(function (d) {
        state.metricHistory.ups = d; renderUpsCharts();
      }).catch(function (e) { console.error('ups history', e); })
    ]);
  }

  /* ============================================================
   *  WebSocket
   * ============================================================ */
  var ws = null, reconnectTimer = null;
  function wsConnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { ws = new WebSocket(WS_URL); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = function () { state.connected = true; renderWsIndicator(); };
    ws.onclose = function () { state.connected = false; renderWsIndicator(); scheduleReconnect(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
    ws.onmessage = function (ev) {
      try { handleWsMessage(JSON.parse(ev.data)); } catch (e) {}
    };
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; wsConnect(); }, RECONNECT_DELAY_MS);
  }
  function handleWsMessage(msg) {
    if (!msg || !msg.type) return;
    var d = msg.data || {};
    switch (msg.type) {
      case 'init': reloadSystems(); reloadAlarms(); reloadFeatureFlags(); break;
      case 'metric': applyMetricUpdate(d); break;
      case 'system': applySystemUpdate(d); break;
      case 'alarm': applyAlarmUpdate(msg); break;
      case 'alarm-resolved': applyAlarmResolved(d); break;
      case 'settings':
        if (d && (d.temperatureEnabled !== undefined || d.upsEnabled !== undefined || d.gateEnabled !== undefined)) {
          if (d.temperatureEnabled !== undefined) state.featureFlags.temperatureEnabled = d.temperatureEnabled !== 'false';
          if (d.upsEnabled !== undefined) state.featureFlags.upsEnabled = d.upsEnabled !== 'false';
          if (d.gateEnabled !== undefined) state.featureFlags.gateEnabled = d.gateEnabled !== 'false';
          if (!state.featureFlags.temperatureEnabled) {
            var tf = state.filter.typeFilter;
            if (tf === 'hot' || tf === 'cold' || tf === 'dry' || tf === 'humid') state.filter.typeFilter = 'all';
          }
          renderAlarms();
        }
        break;
      case 'delete':
        if (d.systemId && state.systemsById[d.systemId]) {
          delete state.systemsById[d.systemId];
          renderTopbar(); renderEquipment(); renderSensors(); renderUps();
        }
        break;
    }
  }

  /* Alarm WS handling — mirrors alarms-client.tsx handleMessage */
  function applyAlarmUpdate(msg) {
    var d = msg.data || {};
    var ts = msg.timestamp || Date.now();

    /* Bulk acknowledge */
    if (d.acknowledged && d.bulk && d.alarmIds) {
      var ids = {};
      for (var i = 0; i < d.alarmIds.length; i++) ids[d.alarmIds[i]] = true;
      var ackTime = new Date(ts);
      for (var j = 0; j < state.alarms.length; j++) {
        var al = state.alarms[j];
        if (ids[al.id] && !al.acknowledged) {
          al.acknowledged = true;
          al.acknowledgedAt = ackTime;
        }
      }
      renderEquipment(); renderAlarms();
      return;
    }

    /* Single acknowledge from another client */
    if (d.acknowledged && d.alarmId) {
      for (var k = 0; k < state.alarms.length; k++) {
        if (state.alarms[k].id === d.alarmId && !state.alarms[k].acknowledged) {
          state.alarms[k].acknowledged = true;
          state.alarms[k].acknowledgedAt = new Date(ts);
          break;
        }
      }
      renderEquipment(); renderAlarms();
      return;
    }

    /* New alarm */
    if (d.alarmId && d.severity && d.message && d.systemId) {
      var exists = false;
      for (var e = 0; e < state.alarms.length; e++) {
        if (state.alarms[e].id === d.alarmId) { exists = true; break; }
      }
      if (!exists) {
        state.alarms.unshift({
          id: d.alarmId,
          systemId: d.systemId,
          severity: d.severity,
          message: d.message,
          value: d.alarmValue || null,
          acknowledged: d.acknowledged || false,
          acknowledgedAt: null,
          createdAt: new Date(ts),
          resolvedAt: null,
          system: { id: d.systemId, name: d.systemName || '', type: (state.systemsById[d.systemId] && state.systemsById[d.systemId].type) || '' }
        });
        renderEquipment(); renderAlarms();
      }
    }
  }

  function applyAlarmResolved(d) {
    if (!d || !d.systemId) return;
    var now = new Date();
    var resolved = 0;
    for (var i = 0; i < state.alarms.length; i++) {
      var a = state.alarms[i];
      if (a.systemId === d.systemId && a.resolvedAt === null && !a.acknowledged) {
        a.resolvedAt = now;
        resolved++;
      }
    }
    if (resolved > 0) { renderEquipment(); renderAlarms(); }
  }
  function applyMetricUpdate(d) {
    var sys = state.systemsById[d.systemId];
    if (!sys || !sys.metrics) return;
    var metric = null;
    for (var i = 0; i < sys.metrics.length; i++) {
      var m = sys.metrics[i];
      if (m.id === d.metricId || m.name === d.metricName) {
        m.value = d.value;
        if (d.textValue !== undefined) m.textValue = d.textValue;
        if (d.trend !== undefined) m.trend = d.trend;
        metric = m;
        break;
      }
    }
    /* Append to chart history (throttled per-metric). This keeps charts fresh
     * without re-fetching 24h from the DB every minute. */
    if (metric && typeof d.value === 'number' && (sys.type === 'sensor' || sys.type === 'ups')) {
      appendHistoryPoint(sys, metric, d.value);
    }
    if (sys.type === 'sensor') scheduleRender('sensor');
    else if (sys.type === 'ups') scheduleRender('ups');
  }

  var appendThrottle = {};
  var HISTORY_CUTOFF_MS = 24 * 60 * 60 * 1000;
  function appendHistoryPoint(sys, metric, value) {
    var now = Date.now();
    var key = metric.id || (sys.id + ':' + metric.name);
    if (appendThrottle[key] && (now - appendThrottle[key]) < HISTORY_APPEND_THROTTLE_MS) return;
    appendThrottle[key] = now;

    var bucket = sys.type === 'sensor' ? state.metricHistory.sensor : state.metricHistory.ups;
    if (!bucket) return;
    var entry = null;
    for (var i = 0; i < bucket.length; i++) {
      if (bucket[i].id === metric.id || (bucket[i].name === metric.name && bucket[i].systemId === sys.id)) {
        entry = bucket[i]; break;
      }
    }
    var recordedAt = new Date(now).toISOString();
    if (!entry) {
      entry = {
        id: metric.id, name: metric.name, unit: metric.unit, systemId: sys.id,
        system: { name: sys.name }, history: []
      };
      bucket.push(entry);
    }
    entry.history.push({ value: value, recordedAt: recordedAt });
    /* Trim to 24h window */
    var cutoff = now - HISTORY_CUTOFF_MS;
    if (entry.history.length > 2000) {
      var idx = 0;
      while (idx < entry.history.length && new Date(entry.history[idx].recordedAt).getTime() < cutoff) idx++;
      if (idx > 0) entry.history = entry.history.slice(idx);
    }
    scheduleChartRefresh(sys.type);
  }

  /* Coalesce card renders to at most 1/sec per panel. TV viewers can't read
   * faster than that, and the gauges/tables don't animate. */
  var PANEL_RENDER_THROTTLE_MS = 1000;
  var renderScheduled = { sensor: false, ups: false };
  function scheduleRender(kind) {
    if (renderScheduled[kind]) return;
    renderScheduled[kind] = true;
    setTimeout(function () {
      renderScheduled[kind] = false;
      if (kind === 'sensor') renderSensors();
      else if (kind === 'ups') renderUps();
    }, PANEL_RENDER_THROTTLE_MS);
  }

  /* Chart refresh is more expensive — throttle to 10s. */
  var chartRefreshTimer = { sensor: null, ups: null };
  function scheduleChartRefresh(kind) {
    if (chartRefreshTimer[kind]) return;
    chartRefreshTimer[kind] = setTimeout(function () {
      chartRefreshTimer[kind] = null;
      if (kind === 'sensor') renderSensorCharts();
      else if (kind === 'ups') renderUpsCharts();
    }, HISTORY_APPEND_THROTTLE_MS);
  }
  function applySystemUpdate(d) {
    var sys = state.systemsById[d.systemId];
    if (!sys) return;
    sys.status = d.status;
    renderTopbar();
    if (sys.type === 'equipment' || sys.type === '장비상태') renderEquipment();
    else if (sys.type === 'sensor') renderSensors();
    else if (sys.type === 'ups') renderUps();
  }

  /* ============================================================
   *  Topbar
   * ============================================================ */
  function renderTopbar() {
    var list = [];
    for (var id in state.systemsById) if (Object.prototype.hasOwnProperty.call(state.systemsById, id)) list.push(state.systemsById[id]);
    var enabled = list.filter(function (s) { return s.isEnabled !== false; });
    var disabled = list.filter(function (s) { return s.isEnabled === false; });
    var ok = 0, warn = 0, crit = 0;
    for (var i = 0; i < enabled.length; i++) {
      var st = enabled[i].status;
      if (st === 'normal') ok++;
      else if (st === 'warning' || st === 'offline') warn++;
      else if (st === 'critical') crit++;
    }
    setText('sc-ok', ok); setText('sc-warn', warn); setText('sc-crit', crit); setText('sc-off', disabled.length);
  }
  function renderWsIndicator() {
    var el = $('ws-indicator');
    if (!el) return;
    if (state.connected) el.setAttribute('hidden', ''); else el.removeAttribute('hidden');
  }
  function tickClock() {
    var d = new Date();
    var n = $('eq-normal-clock-text');
    if (n) n.textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    var dn = $('eq-normal-date-text');
    if (dn) dn.textContent = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  }

  function renderTopbarIcons() {
    var host = $('tb-icons');
    if (!host) return;
    clear(host);
    var icons = [
      { name: 'volume', svg: SVG.volume2, title: '음소거' },
      { name: 'gate',   svg: SVG.doorClosed, title: '게이트 열기' },
      { name: 'settings', svg: SVG.settings, title: '설정' },
      { name: 'fullscreen', svg: SVG.maximize2, title: '전체화면', onClick: toggleFullscreen }
    ];
    for (var i = 0; i < icons.length; i++) {
      var b = document.createElement('button');
      b.className = 'tb-icon-btn';
      b.setAttribute('title', icons[i].title);
      b.innerHTML = icons[i].svg;
      if (icons[i].onClick) b.onclick = icons[i].onClick;
      host.appendChild(b);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  /* ============================================================
   *  Equipment quadrant
   * ============================================================ */
  function isSensorAlarm(a) {
    if (!a.message) return false;
    if (!a.system || a.system.type !== 'sensor') return false;
    return a.message.indexOf('고온') >= 0 || a.message.indexOf('저온') >= 0
        || a.message.indexOf('건조') >= 0 || a.message.indexOf('다습') >= 0;
  }

  function renderEquipment() {
    renderEquipmentSidebar();
    renderEquipmentMain();
  }

  function renderEquipmentSidebar() {
    var host = $('eq-sidebar');
    if (!host) return;
    var equipment = getSystems('equipment');
    /* Preserve server order (matches original dashboard) */
    clear(host);
    for (var i = 0; i < equipment.length; i++) host.appendChild(buildHealthCard(equipment[i]));
    var add = el('div', 'hc-card hc-add', '+');
    host.appendChild(add);
  }

  function buildHealthCard(sys) {
    var card = el('div', 'hc-card');
    var enabled = sys.isEnabled !== false;
    var cls;
    if (!enabled) cls = 'hc-disabled';
    else if (sys.status === 'normal') cls = 'hc-normal';
    else if (sys.status === 'warning') cls = 'hc-warning';
    else if (sys.status === 'critical') cls = 'hc-critical';
    else if (sys.status === 'offline') cls = 'hc-offline';
    else cls = 'hc-disabled';
    card.className = 'hc-card ' + cls;
    card.appendChild(el('div', 'hc-name', sys.name || ''));
    var label;
    if (!enabled) label = '비활성';
    else if (sys.status === 'normal') label = '정상';
    else if (sys.status === 'warning') label = '오프라인';
    else if (sys.status === 'critical') label = '경고';
    else if (sys.status === 'offline') label = '오프라인';
    else label = '오프라인';
    card.appendChild(el('span', 'hc-badge', label));
    return card;
  }

  function renderEquipmentMain() {
    var host = $('eq-main');
    if (!host) return;
    var equipment = getSystems('equipment');
    var enabledEquip = equipment.filter(function (s) { return s.isEnabled !== false; });
    var problems = enabledEquip.filter(function (s) {
      return s.status === 'critical' || s.status === 'warning' || s.status === 'offline';
    });
    var unacked = state.alarms.filter(function (a) { return !a.acknowledged && !a.resolvedAt; });
    var sensorAlarms = unacked.filter(isSensorAlarm);
    var equipUnacked = unacked.filter(function (a) {
      for (var i = 0; i < sensorAlarms.length; i++) if (sensorAlarms[i].id === a.id) return false;
      return true;
    });
    var hasEquipProblems = problems.length > 0 || equipUnacked.length > 0;
    var activeProblems = problems.filter(function (s) { return s.status === 'critical' || s.status === 'warning'; });
    var offlineProblems = problems.filter(function (s) { return s.status === 'offline'; });
    var criticalOrWarnAlarms = equipUnacked.filter(function (a) { return a.severity === 'critical' || a.severity === 'warning'; });
    var hasCritical = activeProblems.length > 0 || criticalOrWarnAlarms.length > 0;
    var isOfflineOnly = !hasCritical && hasEquipProblems;

    clear(host);
    if (hasEquipProblems) {
      var header = el('div', 'eq-alert-header' + (isOfflineOnly ? ' offline-only' : ''));
      var iconL = document.createElement('span'); iconL.innerHTML = SVG.alertTriangle; header.appendChild(iconL.firstChild);
      header.appendChild(el('span', null, isOfflineOnly ? '오프라인' : '장애발생'));
      var iconR = document.createElement('span'); iconR.innerHTML = SVG.alertTriangle; header.appendChild(iconR.firstChild);
      host.appendChild(header);

      var list = el('div', 'eq-problem-list');
      problems.filter(function (s) { return s.status === 'critical'; }).forEach(function (sys) {
        list.appendChild(buildProblemCard(sys, 'eq-p-critical', sys.name));
      });
      problems.filter(function (s) { return s.status === 'warning'; }).forEach(function (sys) {
        list.appendChild(buildProblemCard(sys, 'eq-p-warning', sys.name));
      });
      offlineProblems.forEach(function (sys) {
        list.appendChild(buildProblemCard(sys, 'eq-p-offline', sys.name));
      });
      // Unacked alarms not tied to problem system
      equipUnacked.filter(function (a) {
        for (var i = 0; i < problems.length; i++) if (problems[i].id === a.systemId) return false;
        return true;
      }).slice(0, 5).forEach(function (a) {
        var cls = a.severity === 'critical' ? 'eq-p-critical' : (a.severity === 'offline' ? 'eq-p-offline' : 'eq-p-warning');
        list.appendChild(buildProblemCard(null, cls, (a.system && a.system.name) || '시스템'));
      });
      host.appendChild(list);
    } else {
      host.appendChild(buildNormalRadar(enabledEquip.length));
    }
  }

  function buildProblemCard(sys, cls, name) {
    var card = el('div', 'eq-problem-card ' + cls);
    card.appendChild(el('span', 'eq-problem-card-name', name));
    return card;
  }

  function buildNormalRadar(count) {
    var wrap = el('div', 'eq-normal');
    var radar = el('div', 'radar-wrap');
    radar.appendChild(el('div', 'radar-glow'));
    // Orbit dots
    var orbitCount = 8;
    var minR = 40, maxR = 120;
    for (var i = 0; i < orbitCount; i++) {
      var r = minR + Math.round(i * ((maxR - minR) / Math.max(orbitCount - 1, 1)));
      var duration = 20 + i * 4;
      var startAngle = (i * 137.508) % 360;
      var delay = (startAngle / 360) * duration;
      var sz = 5 + (i % 3) * 2;
      var orb = el('div', 'orbit');
      orb.style.animation = 'orbit ' + duration + 's linear infinite';
      orb.style.animationDelay = '-' + delay + 's';
      orb.style.setProperty('--orbit-radius', r + 'px');
      var dot = el('div', 'orbit-dot');
      dot.style.width = sz + 'px';
      dot.style.height = sz + 'px';
      dot.style.marginLeft = (-sz/2) + 'px';
      dot.style.marginTop = (-sz/2) + 'px';
      dot.style.boxShadow = '0 0 ' + (sz*2) + 'px rgba(134,239,172,0.9), 0 0 ' + (sz*4) + 'px rgba(74,222,128,0.5)';
      orb.appendChild(dot);
      radar.appendChild(orb);
    }
    var icon = el('div', 'radar-icon');
    icon.appendChild(el('div', 'radar-ring radar-ring-1'));
    icon.appendChild(el('div', 'radar-ring radar-ring-2'));
    icon.appendChild(el('div', 'radar-ring radar-ring-3'));
    icon.appendChild(el('div', 'radar-cross-v'));
    icon.appendChild(el('div', 'radar-cross-h'));
    var ctr = el('div', 'radar-center');
    var chk = document.createElement('span'); chk.innerHTML = SVG.check; ctr.appendChild(chk.firstChild);
    icon.appendChild(ctr);
    radar.appendChild(icon);
    wrap.appendChild(radar);
    wrap.appendChild(el('div', 'eq-normal-title', '모든 시스템 정상'));
    wrap.appendChild(el('div', 'eq-normal-subtitle', 'All Systems Operational'));
    var countBadge = el('div', 'eq-normal-count');
    var act = document.createElement('span'); act.innerHTML = SVG.activity; countBadge.appendChild(act.firstChild);
    countBadge.appendChild(el('span', null, count + '개 시설 정상 운영 중'));
    wrap.appendChild(countBadge);
    var clock = el('div', 'eq-normal-clock'); clock.id = 'eq-normal-clock-text'; wrap.appendChild(clock);
    var date = el('div', 'eq-normal-date'); date.id = 'eq-normal-date-text'; wrap.appendChild(date);
    tickClock();
    return wrap;
  }

  /* ============================================================
   *  Temperature / Sensor quadrant
   * ============================================================ */
  function renderSensors() {
    var host = $('sensor-gauges');
    if (!host) return;
    var sensors = getSystems('sensor');
    /* Preserve server order so sensor→color mapping matches card dot and chart line */
    setText('q-sensor-sub', sensors.length + '개');
    host.className = 'sensor-gauges ' + (sensors.length <= 4 ? 'cols-1' : 'cols-2');
    clear(host);
    if (sensors.length === 0) {
      host.appendChild(emptyState('등록된 센서 시스템이 없습니다'));
      return;
    }
    for (var i = 0; i < sensors.length; i++) host.appendChild(buildSensorCard(sensors[i], i));
  }

  function buildSensorCard(sys, idx) {
    var card = el('div', 'sensor-card');
    var dot = el('span', 'sensor-card-dot');
    dot.style.background = SENSOR_COLORS[idx % SENSOR_COLORS.length];
    card.appendChild(dot);
    card.appendChild(el('div', 'sensor-card-title', sys.name || ''));
    var cfg = parseConfig(sys.config);
    var tempConds = null, humidConds = null;
    var tempMax = 50, humidMax = 100;
    if (cfg && cfg.displayItems) {
      for (var i = 0; i < cfg.displayItems.length; i++) {
        var it = cfg.displayItems[i];
        if (it.name === '온도' && it.conditions) {
          tempConds = it.conditions;
          if (it.conditions.normal && it.conditions.normal[0]) tempMax = Math.round(it.conditions.normal[0].value1 * 2);
        } else if (it.name === '습도' && it.conditions) {
          humidConds = it.conditions;
        }
      }
    }
    var row = el('div', 'sensor-gauges-row');
    row.appendChild(buildGaugeCell(findMetric(sys, '온도'), 0, tempMax, '°C', tempConds, 'temp', '온도'));
    row.appendChild(buildGaugeCell(findMetric(sys, '습도'), 0, humidMax, '%', humidConds, 'humid', '습도'));
    card.appendChild(row);
    return card;
  }

  function buildGaugeCell(metric, lo, hi, unit, conds, kind, labelText) {
    var cell = el('div', 'sensor-gauge-cell');
    var box = el('div', 'gauge-box');
    if (metric && typeof metric.value === 'number') {
      box.innerHTML = gaugeSvg(metric.value, lo, hi, unit, conds, kind, labelText);
    } else {
      box.appendChild(el('span', 'empty-state', '-'));
    }
    cell.appendChild(box);
    if (conds) {
      var lbls = el('div', 'gauge-labels');
      if (kind === 'temp') {
        if (conds.critical && conds.critical[0]) {
          var r = el('div', 'gauge-label-row');
          r.appendChild(el('span', 'gauge-label-dot gauge-label-red'));
          r.appendChild(el('span', null, '고온 ' + conds.critical[0].value1 + '°C'));
          lbls.appendChild(r);
        }
        if (conds.coldCritical && conds.coldCritical[0]) {
          var r2 = el('div', 'gauge-label-row');
          r2.appendChild(el('span', 'gauge-label-dot gauge-label-blue'));
          r2.appendChild(el('span', null, '저온 ' + conds.coldCritical[0].value1 + '°C'));
          lbls.appendChild(r2);
        }
      } else {
        if (conds.dryCritical && conds.dryCritical[0]) {
          var r3 = el('div', 'gauge-label-row');
          r3.appendChild(el('span', 'gauge-label-dot gauge-label-orange'));
          r3.appendChild(el('span', null, '건조 ' + conds.dryCritical[0].value1 + '%'));
          lbls.appendChild(r3);
        }
        if (conds.humidCritical && conds.humidCritical[0]) {
          var r4 = el('div', 'gauge-label-row');
          r4.appendChild(el('span', 'gauge-label-dot gauge-label-cyan'));
          r4.appendChild(el('span', null, '다습 ' + conds.humidCritical[0].value1 + '%'));
          lbls.appendChild(r4);
        }
      }
      cell.appendChild(lbls);
    }
    return cell;
  }

  function gaugeSvg(value, lo, hi, unit, conds, kind, labelText) {
    var r = 42;
    var circ = 2 * Math.PI * r;
    var arcLen = circ * 0.75;
    var pct = clamp((value - lo) / (hi - lo), 0, 1);
    var offset = circ * (1 - pct * 0.75);
    var color = '#4ade80';
    var gradId = 'gradient-normal';
    if (conds) {
      var status = evalStatus(value, conds);
      if (status === 'critical') {
        if (isColdCritical(value, conds)) { color = '#3b82f6'; gradId = 'gradient-cold'; }
        else if (isDryCritical(value, conds)) { color = '#f97316'; gradId = 'gradient-dry'; }
        else if (isHumidCritical(value, conds)) { color = '#06b6d4'; gradId = 'gradient-humid'; }
        else { color = '#f87171'; gradId = 'gradient-critical'; }
      } else if (status === 'warning') {
        color = '#facc15'; gradId = 'gradient-warning';
      }
    }
    var defs = '<defs>'
      + '<linearGradient id="grad-normal"><stop offset="0%" stop-color="#4ade80"/><stop offset="100%" stop-color="#86efac"/></linearGradient>'
      + '<linearGradient id="grad-warning"><stop offset="0%" stop-color="#facc15"/><stop offset="100%" stop-color="#fde047"/></linearGradient>'
      + '<linearGradient id="grad-critical"><stop offset="0%" stop-color="#f87171"/><stop offset="100%" stop-color="#fca5a5"/></linearGradient>'
      + '<linearGradient id="grad-cold"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#93c5fd"/></linearGradient>'
      + '<linearGradient id="grad-dry"><stop offset="0%" stop-color="#f97316"/><stop offset="100%" stop-color="#fdba74"/></linearGradient>'
      + '<linearGradient id="grad-humid"><stop offset="0%" stop-color="#06b6d4"/><stop offset="100%" stop-color="#67e8f9"/></linearGradient>'
      + '</defs>';
    // Map gradient id: since gradients must be unique per SVG, we reference by type
    var grad = 'grad-' + gradId.replace('gradient-', '');
    // Arcs rotated 135deg around center so the gap is at the bottom.
    // Keep text upright (not rotated).
    var arcs = '<g transform="rotate(135 50 50)">'
      + '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="#333" stroke-width="10" stroke-dasharray="' + arcLen + ' ' + circ + '" stroke-linecap="round"/>'
      + '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="url(#' + grad + ')" stroke-width="10" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"/>'
      + '</g>';
    var valueText = '<text x="50" y="50" text-anchor="middle" dominant-baseline="middle" fill="' + color + '" style="font-weight:700;font-variant-numeric:tabular-nums;" font-size="26">' + Math.round(value) + '<tspan font-size="15">' + unit + '</tspan></text>';
    var labelSvg = '';
    if (labelText) {
      var ic = kind === 'temp'
        ? '<path d="M 57 64 v 7 a 3 3 0 1 1 -6 0 v -7 a 2 2 0 1 1 6 0 Z" fill="none" stroke="#f87171" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<path d="M 54 62 l 3 3 a 4.2 4.2 0 1 1 -6 0 Z" fill="none" stroke="#60a5fa" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>';
      labelSvg = ic + '<text x="61" y="69.5" text-anchor="start" fill="#a1a1aa" font-size="8">' + labelText + '</text>';
    }
    return '<svg class="gauge-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">' + defs + arcs + valueText + labelSvg + '</svg>';
  }

  /* Sensor status thresholds — full port of lib/threshold-evaluator
   * Priority: critical/coldCritical/dryCritical/humidCritical > normal
   * Within each bucket, any condition matching triggers that status (OR). */
  function evaluateCondition(value, c) {
    if (!c) return false;
    switch (c.operator) {
      case 'between': {
        var v2 = (c.value2 === undefined || c.value2 === null) ? c.value1 : c.value2;
        return value >= c.value1 && value <= v2;
      }
      case 'gte': return value >= c.value1;
      case 'lte': return value <= c.value1;
      case 'eq':
        if (c.stringValue !== undefined) return String(value) === c.stringValue;
        return value === c.value1;
      case 'neq':
        if (c.stringValue !== undefined) return String(value) !== c.stringValue;
        return value !== c.value1;
      default: return false;
    }
  }
  function matchConds(arr, value) {
    if (!arr) return false;
    for (var i = 0; i < arr.length; i++) if (evaluateCondition(value, arr[i])) return true;
    return false;
  }
  function evalStatus(value, conds) {
    if (!conds) return 'normal';
    if (matchConds(conds.critical, value)) return 'critical';
    if (matchConds(conds.coldCritical, value)) return 'critical';
    if (matchConds(conds.dryCritical, value)) return 'critical';
    if (matchConds(conds.humidCritical, value)) return 'critical';
    return 'normal';
  }
  function isColdCritical(v, c) { return matchConds(c.coldCritical, v); }
  function isDryCritical(v, c) { return matchConds(c.dryCritical, v); }
  function isHumidCritical(v, c) { return matchConds(c.humidCritical, v); }

  function renderSensorCharts() {
    /* Temperature Y-axis: default 16~26, expand to cover out-of-range data.
     * Matches realtime-temperature.tsx tempYDomain. */
    var min = 16, max = 26;
    var temps = (state.metricHistory.sensor || []).filter(function (m) { return m.name === '온도'; });
    for (var i = 0; i < temps.length; i++) {
      var hist = temps[i].history || [];
      for (var j = 0; j < hist.length; j++) {
        var v = hist[j].value;
        if (typeof v === 'number') {
          if (v < min) min = Math.floor(v) - 1;
          if (v > max) max = Math.ceil(v) + 1;
        }
      }
    }
    renderMetricChart('chart-temp', state.metricHistory.sensor, '온도', [min, max], 'sensor:temp');
    renderMetricChart('chart-humid', state.metricHistory.sensor, '습도', [0, 100], 'sensor:humid');
  }

  /* ============================================================
   *  UPS quadrant
   * ============================================================ */
  function renderUps() {
    var host = $('ups-cards');
    if (!host) return;
    var ups = getSystems('ups');
    // Sort: main systems alphabetical, 경항공기 통신실 last
    var main = ups.filter(function (s) { return s.name !== '경항공기 통신실'; });
    var sub = ups.filter(function (s) { return s.name === '경항공기 통신실'; });
    main.sort(function (a, b) {
      var na = a.name || '', nb = b.name || '';
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });
    var ordered = main.concat(sub);

    setText('q-ups-sub', ups.length + '개');
    clear(host);
    if (ups.length === 0) { host.appendChild(emptyState('등록된 UPS 시스템이 없습니다')); return; }
    for (var i = 0; i < ordered.length; i++) host.appendChild(buildUpsCard(ordered[i], i));
  }

  function buildUpsCard(sys, idx) {
    var card = el('div', 'ups-card');
    var head = el('div', 'ups-card-head');
    var dot = el('span', 'ups-card-dot');
    dot.style.background = UPS_COLORS[idx % UPS_COLORS.length];
    head.appendChild(dot);
    head.appendChild(el('span', 'ups-card-name', sys.name || ''));
    var stCls = 'st-' + (sys.status || 'offline');
    head.appendChild(el('span', 'ups-card-status ' + stCls, statusLabel(sys.status)));
    card.appendChild(head);

    var cfg = parseConfig(sys.config);
    var displayItems = (cfg && cfg.displayItems) || [];
    var metrics = sys.metrics || [];
    // Sort metrics by displayItems order
    if (displayItems.length > 0) {
      var order = {};
      for (var i = 0; i < displayItems.length; i++) order[displayItems[i].name] = i;
      metrics = metrics.slice().sort(function (a, b) {
        var ai = order[a.name]; var bi = order[b.name];
        if (ai === undefined) ai = 999;
        if (bi === undefined) bi = 999;
        return ai - bi;
      });
    }

    var table = document.createElement('table');
    table.className = 'ups-table';
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    for (var j = 0; j < metrics.length; j++) {
      var m = metrics[j];
      var di = null;
      for (var k = 0; k < displayItems.length; k++) if (displayItems[k].name === m.name) { di = displayItems[k]; break; }
      var ms = 'normal';
      if (di) ms = getMetricStatus(m.value, di, m.textValue);
      var tr = document.createElement('tr');
      tr.className = 'ups-tr' + (ms === 'critical' ? ' crit-row' : '');
      var tdName = document.createElement('td');
      tdName.className = 'ups-td ups-td-name';
      tdName.textContent = m.name;
      tr.appendChild(tdName);

      var tdBar = document.createElement('td');
      tdBar.className = 'ups-td ups-td-bar';
      var barRange = getBarRange(m, di);
      if (barRange) {
        var wrap = el('div', 'ups-bar-wrap');
        var fill = el('div', 'ups-bar-fill bar-' + ms);
        var pct = ((m.value - barRange[0]) / (barRange[1] - barRange[0])) * 100;
        if (pct < 0) pct = 0; if (pct > 100) pct = 100;
        fill.style.width = pct.toFixed(1) + '%';
        wrap.appendChild(fill);
        tdBar.appendChild(wrap);
      }
      tr.appendChild(tdBar);

      var tdVal = document.createElement('td');
      tdVal.className = 'ups-td ups-td-val st-' + ms;
      tdVal.textContent = (m.textValue !== null && m.textValue !== undefined)
        ? String(m.textValue)
        : formatNum(m.value);
      tr.appendChild(tdVal);

      var tdUnit = document.createElement('td');
      tdUnit.className = 'ups-td ups-td-unit';
      tdUnit.textContent = m.unit || '';
      tr.appendChild(tdUnit);
      tbody.appendChild(tr);
    }
    card.appendChild(table);
    return card;
  }

  function getMetricStatus(value, item, textValue) {
    if (!item || item.alarmEnabled === false) return 'normal';
    if (item.conditions && item.conditions.critical) {
      for (var i = 0; i < item.conditions.critical.length; i++) {
        var c = item.conditions.critical[i];
        if (c.operator === 'gte' && value >= c.value1) return 'critical';
        if (c.operator === 'lte' && value <= c.value1) return 'critical';
        if (c.operator === 'eq') {
          var cv = textValue != null ? textValue : String(value);
          var tg = c.stringValue != null ? c.stringValue : String(c.value1);
          if (cv === tg) return 'critical';
        }
        if (c.operator === 'neq') {
          var cv2 = textValue != null ? textValue : String(value);
          var tg2 = c.stringValue != null ? c.stringValue : String(c.value1);
          if (cv2 !== tg2) return 'critical';
        }
      }
      return 'normal';
    }
    if (item.critical != null && value >= item.critical) return 'critical';
    if (item.warning != null && value <= item.warning) return 'critical';
    return 'normal';
  }

  function getBarRange(metric, di) {
    if (metric.textValue !== null && metric.textValue !== undefined) return null;
    if (!di) return null;
    if (metric.unit === '%') return [0, 100];
    if (di.conditions && di.conditions.critical) {
      var lo = null, hi = null;
      for (var i = 0; i < di.conditions.critical.length; i++) {
        var c = di.conditions.critical[i];
        if (c.operator === 'lte') lo = c.value1;
        if (c.operator === 'gte') hi = c.value1;
      }
      if (lo != null && hi != null) return [lo, hi];
    }
    if (di.warning != null && di.critical != null) return [di.warning, di.critical];
    if (di.itemType && UPS_BAR_RANGES[di.itemType]) return UPS_BAR_RANGES[di.itemType];
    return null;
  }

  function statusLabel(st) {
    if (st === 'normal') return '정상';
    if (st === 'warning') return '경고';
    if (st === 'critical') return '경고';
    if (st === 'offline') return '오프라인';
    return '오프라인';
  }

  /* Resolve chart group for a metric — port of realtime-ups.tsx resolveChartGroup.
   * Returns the group name the metric belongs to, or null if it shouldn't chart. */
  function resolveChartGroup(metricName, systemConfig) {
    if (systemConfig && systemConfig.displayItems) {
      for (var i = 0; i < systemConfig.displayItems.length; i++) {
        var it = systemConfig.displayItems[i];
        if (it.name === metricName) {
          if (it.chartGroup !== undefined) return it.chartGroup;
          if (it.chartEnabled !== false && DEFAULT_CHART_METRIC_NAMES.indexOf(metricName) >= 0) return metricName;
          return null;
        }
      }
    }
    if (DEFAULT_CHART_METRIC_NAMES.indexOf(metricName) >= 0) return metricName;
    return null;
  }

  function renderUpsCharts() {
    var host = $('ups-charts');
    if (!host) return;
    clear(host);
    for (var key in state.charts) {
      if (Object.prototype.hasOwnProperty.call(state.charts, key) && key.indexOf('ups:') === 0) {
        try { state.charts[key].u.destroy(); } catch (e) {}
        delete state.charts[key];
      }
    }
    /* Determine chart group names: iterate all UPS configs; keep default order when possible,
     * then append any custom groups not in the default list.
     * Matches realtime-ups.tsx chartGroupNames. */
    var groupsSet = {};
    var ups = getSystems('ups');
    var systemCfgById = {};
    for (var i = 0; i < ups.length; i++) {
      var cfg = parseConfig(ups[i].config);
      if (cfg) {
        systemCfgById[ups[i].id] = cfg;
        if (cfg.displayItems) {
          for (var j = 0; j < cfg.displayItems.length; j++) {
            var it = cfg.displayItems[j];
            if (it.chartGroup) groupsSet[it.chartGroup] = true;
            else if (it.chartGroup === undefined && it.chartEnabled !== false && DEFAULT_CHART_METRIC_NAMES.indexOf(it.name) >= 0) groupsSet[it.name] = true;
          }
        }
      }
    }
    var names = [];
    var usingDefaults = true;
    for (var gk in groupsSet) if (Object.prototype.hasOwnProperty.call(groupsSet, gk)) { usingDefaults = false; break; }
    if (usingDefaults) {
      for (var d = 0; d < DEFAULT_CHART_METRIC_NAMES.length; d++) names.push(DEFAULT_CHART_METRIC_NAMES[d]);
    } else {
      for (var dn = 0; dn < DEFAULT_CHART_METRIC_NAMES.length; dn++) {
        if (groupsSet[DEFAULT_CHART_METRIC_NAMES[dn]]) names.push(DEFAULT_CHART_METRIC_NAMES[dn]);
      }
      for (var cgk in groupsSet) {
        if (Object.prototype.hasOwnProperty.call(groupsSet, cgk) && DEFAULT_CHART_METRIC_NAMES.indexOf(cgk) < 0) names.push(cgk);
      }
    }
    for (var k = 0; k < names.length; k++) {
      var name = names[k];
      var cell = el('div', 'chart-card');
      cell.appendChild(el('div', 'chart-title-row', null));
      cell.firstChild.appendChild(el('span', 'chart-title', name));
      var body = el('div', 'chart-body');
      body.id = 'chart-ups-' + k;
      cell.appendChild(body);
      host.appendChild(cell);
      renderGroupChart(body.id, state.metricHistory.ups, name, systemCfgById, UPS_FIXED_Y[name] || null, 'ups:' + name);
    }
  }

  /* Render a chart for a UPS chart group: one series per system-metric pair.
   * Metrics that resolve to `groupName` are grouped; display-name strips group prefix. */
  function renderGroupChart(containerId, historyList, groupName, systemCfgById, yDomain, chartKey) {
    var cell = $(containerId);
    if (!cell) return;
    clear(cell);
    if (!window.uPlot) { cell.appendChild(emptyState('uPlot 로드 실패')); return; }

    var members = [];
    for (var i = 0; i < (historyList || []).length; i++) {
      var m = historyList[i];
      var cfg = systemCfgById[m.systemId];
      if (resolveChartGroup(m.name, cfg) === groupName) members.push(m);
    }
    if (members.length === 0) { cell.appendChild(emptyState('데이터 없음')); return; }

    var tsSet = {};
    for (var a = 0; a < members.length; a++) {
      var h = members[a].history || [];
      for (var b = 0; b < h.length; b++) {
        var t = Math.floor(new Date(h[b].recordedAt).getTime() / 1000);
        tsSet[t] = true;
      }
    }
    var allTs = [];
    for (var tk in tsSet) if (Object.prototype.hasOwnProperty.call(tsSet, tk)) allTs.push(parseInt(tk, 10));
    allTs.sort(function (x, y) { return x - y; });
    if (allTs.length === 0) { cell.appendChild(emptyState('데이터 없음')); return; }
    if (allTs.length > 2000) {
      var step = Math.ceil(allTs.length / 2000);
      var reduced = [];
      for (var s = 0; s < allTs.length; s += step) reduced.push(allTs[s]);
      allTs = reduced;
    }

    /* Stable color index: main UPS alphabetical + 경항공기 통신실 last, matches buildUpsCard */
    var colorMap = {};
    var allUps = getSystems('ups');
    var mainSys = allUps.filter(function (u) { return u.name !== '경항공기 통신실'; });
    var subSys = allUps.filter(function (u) { return u.name === '경항공기 통신실'; });
    mainSys.sort(function (p, q) { var np = p.name || '', nq = q.name || ''; return np < nq ? -1 : (np > nq ? 1 : 0); });
    var ordered = mainSys.concat(subSys);
    for (var o = 0; o < ordered.length; o++) colorMap[ordered[o].id] = o;

    var data = [allTs];
    var seriesDefs = [{ label: 'Time' }];
    for (var mi = 0; mi < members.length; mi++) {
      var metric = members[mi];
      var sysName = (metric.system && metric.system.name) || '';
      var suffix = metric.name.indexOf(groupName) === 0 ? metric.name.slice(groupName.length) : metric.name;
      var displayName = suffix ? (sysName + ' ' + suffix) : sysName;
      var colorIdx = colorMap[metric.systemId];
      if (colorIdx === undefined) colorIdx = mi;
      var color = UPS_COLORS[colorIdx % UPS_COLORS.length];
      data.push(fillSeries(allTs, metric.history || []));
      seriesDefs.push({ label: displayName, stroke: color, width: 2, spanGaps: true, points: { show: false } });
    }

    var plot = el('div');
    plot.style.width = '100%';
    plot.style.height = '100%';
    cell.appendChild(plot);
    var rect = plot.getBoundingClientRect();
    var w = Math.max(100, Math.floor(rect.width));
    var h = Math.max(60, Math.floor(rect.height));
    var opts = {
      width: w, height: h, padding: [6, 10, 0, 0],
      legend: { show: false },
      cursor: { x: true, y: false, drag: { x: false, y: false, setScale: false } },
      axes: [
        { stroke: C.axis, font: (IS_4K ? '18px' : '11px') + ' sans-serif', ticks: { stroke: C.grid, width: 1 }, grid: { stroke: C.grid, width: 1, dash: [3,3] },
          values: function (u, splits) {
            var out = [];
            for (var vi = 0; vi < splits.length; vi++) {
              var d = new Date(splits[vi] * 1000);
              out.push(pad(d.getHours()) + ':' + pad(d.getMinutes()));
            }
            return out;
          }, gap: 4 },
        { stroke: C.axis, font: (IS_4K ? '18px' : '11px') + ' sans-serif', ticks: { stroke: C.grid, width: 1 }, grid: { stroke: C.grid, width: 1, dash: [3,3] }, size: IS_4K ? 60 : 36, gap: 4 }
      ],
      series: seriesDefs,
      scales: { x: { time: false } }
    };
    if (yDomain) opts.axes[1].range = function () { return yDomain; };
    var u;
    try { u = new uPlot(opts, data, plot); }
    catch (e) { console.error('uPlot', e); cell.appendChild(emptyState('차트 렌더 실패')); return; }
    state.charts[chartKey || containerId] = { u: u, el: plot };
  }

  /* ============================================================
   *  Chart rendering (uPlot)
   * ============================================================ */
  function renderMetricChart(containerId, historyList, metricName, yDomain, chartKey) {
    var cell = $(containerId);
    if (!cell) return;
    clear(cell);
    if (!window.uPlot) { cell.appendChild(emptyState('uPlot 로드 실패')); return; }
    var filtered = (historyList || []).filter(function (m) { return m.name === metricName; });
    if (filtered.length === 0) { cell.appendChild(emptyState('데이터 없음')); return; }

    var tsSet = {};
    for (var i = 0; i < filtered.length; i++) {
      var h = filtered[i].history || [];
      for (var j = 0; j < h.length; j++) {
        var t = Math.floor(new Date(h[j].recordedAt).getTime() / 1000);
        tsSet[t] = true;
      }
    }
    var allTs = [];
    for (var k in tsSet) if (Object.prototype.hasOwnProperty.call(tsSet, k)) allTs.push(parseInt(k, 10));
    allTs.sort(function (a, b) { return a - b; });
    if (allTs.length === 0) { cell.appendChild(emptyState('데이터 없음')); return; }
    if (allTs.length > 2000) {
      var step = Math.ceil(allTs.length / 2000);
      var reduced = [];
      for (var s = 0; s < allTs.length; s += step) reduced.push(allTs[s]);
      allTs = reduced;
    }

    var data = [allTs];
    var seriesDefs = [{ label: 'Time' }];
    for (var m = 0; m < filtered.length; m++) {
      var metric = filtered[m];
      var color = SENSOR_COLORS[m % SENSOR_COLORS.length];
      data.push(fillSeries(allTs, metric.history || []));
      seriesDefs.push({ label: (metric.system && metric.system.name) || '', stroke: color, width: 2, spanGaps: true, points: { show: false } });
    }

    var plot = el('div');
    plot.style.width = '100%';
    plot.style.height = '100%';
    cell.appendChild(plot);
    var rect = plot.getBoundingClientRect();
    var w = Math.max(100, Math.floor(rect.width));
    var h = Math.max(60, Math.floor(rect.height));
    var opts = {
      width: w, height: h, padding: [6, 10, 0, 0],
      legend: { show: false },
      cursor: { x: true, y: false, drag: { x: false, y: false, setScale: false } },
      axes: [
        { stroke: C.axis, font: (IS_4K ? '18px' : '11px') + ' sans-serif', ticks: { stroke: C.grid, width: 1 }, grid: { stroke: C.grid, width: 1, dash: [3,3] },
          values: function (u, splits) {
            var out = [];
            for (var i = 0; i < splits.length; i++) {
              var d = new Date(splits[i] * 1000);
              out.push(pad(d.getHours()) + ':' + pad(d.getMinutes()));
            }
            return out;
          }, gap: 4 },
        { stroke: C.axis, font: (IS_4K ? '18px' : '11px') + ' sans-serif', ticks: { stroke: C.grid, width: 1 }, grid: { stroke: C.grid, width: 1, dash: [3,3] }, size: IS_4K ? 60 : 36, gap: 4 }
      ],
      series: seriesDefs,
      scales: { x: { time: false } }
    };
    if (yDomain) opts.axes[1].range = function () { return yDomain; };
    var u;
    try { u = new uPlot(opts, data, plot); }
    catch (e) { console.error('uPlot', e); cell.appendChild(emptyState('차트 렌더 실패')); return; }
    state.charts[chartKey || containerId] = { u: u, el: plot };
  }

  function fillSeries(ts, history) {
    var map = {};
    for (var i = 0; i < history.length; i++) {
      var t = Math.floor(new Date(history[i].recordedAt).getTime() / 1000);
      map[t] = history[i].value;
    }
    var out = new Array(ts.length);
    for (var j = 0; j < ts.length; j++) out[j] = Object.prototype.hasOwnProperty.call(map, ts[j]) ? map[ts[j]] : null;
    return out;
  }

  /* ============================================================
   *  Alarms quadrant
   * ============================================================ */
  function initFilterDefaults() {
    if (state.filterInited) return;
    state.filterInited = true;
    var today = new Date();
    var week = new Date(Date.now() - 7 * 86400000);
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    state.filter.dateFrom = ymd(week);
    state.filter.dateTo = ymd(today);
    var f1 = $('f-date-from'); if (f1) f1.value = state.filter.dateFrom;
    var t1 = $('f-time-from'); if (t1) t1.value = state.filter.timeFrom;
    var f2 = $('f-date-to'); if (f2) f2.value = state.filter.dateTo;
    var t2 = $('f-time-to'); if (t2) t2.value = state.filter.timeTo;
    bindFilterEvents();
  }

  function bindFilterEvents() {
    function onDate() {
      state.filter.dateFrom = $('f-date-from').value;
      state.filter.timeFrom = $('f-time-from').value || '00:00';
      state.filter.dateTo = $('f-date-to').value;
      state.filter.timeTo = $('f-time-to').value || '23:59';
      var reset = $('f-date-reset');
      if (reset) {
        if (state.filter.dateFrom || state.filter.dateTo) reset.removeAttribute('hidden');
        else reset.setAttribute('hidden', '');
      }
      renderAlarms();
    }
    var ids = ['f-date-from', 'f-time-from', 'f-date-to', 'f-time-to'];
    for (var i = 0; i < ids.length; i++) {
      var n = $(ids[i]);
      if (n) { n.addEventListener('change', onDate); n.addEventListener('input', onDate); }
    }
    var reset = $('f-date-reset');
    if (reset) reset.addEventListener('click', function () {
      $('f-date-from').value = ''; $('f-time-from').value = '00:00';
      $('f-date-to').value = ''; $('f-time-to').value = '23:59';
      state.filter.dateFrom = ''; state.filter.timeFrom = '00:00';
      state.filter.dateTo = ''; state.filter.timeTo = '23:59';
      reset.setAttribute('hidden', '');
      renderAlarms();
    });
    var all = $('f-sys-all');
    if (all) all.addEventListener('click', function () {
      state.filter.selectedSystems = null; /* all */
      renderFilterSystems();
      renderAlarms();
    });
    var none = $('f-sys-none');
    if (none) none.addEventListener('click', function () {
      state.filter.selectedSystems = {};
      renderFilterSystems();
      renderAlarms();
    });
  }

  function getSelectedSystemsSet() {
    var sel = state.filter.selectedSystems;
    if (sel === null) {
      var out = {};
      for (var id in state.systemsById) if (Object.prototype.hasOwnProperty.call(state.systemsById, id)) out[id] = true;
      return out;
    }
    return sel;
  }

  function filterAlarm(a) {
    var f = state.filter;
    /* Exclude sensor alarms entirely when temperature feature is disabled. */
    if (!state.featureFlags.temperatureEnabled) {
      var sys = a.system || state.systemsById[a.systemId];
      if (sys && sys.type === 'sensor') return false;
    }
    if (f.typeFilter !== 'all') {
      if (f.typeFilter === 'critical' || f.typeFilter === 'warning') {
        if (a.severity !== f.typeFilter) return false;
      } else {
        var map = { hot: '고온', cold: '저온', dry: '건조', humid: '다습' };
        if (!a.message || a.message.indexOf(map[f.typeFilter]) < 0) return false;
      }
    }
    var selected = getSelectedSystemsSet();
    if (!Object.prototype.hasOwnProperty.call(selected, a.systemId)) return false;
    var t = new Date(a.createdAt).getTime();
    if (f.dateFrom) {
      var from = new Date(f.dateFrom + 'T' + (f.timeFrom || '00:00')).getTime();
      if (t < from) return false;
    }
    if (f.dateTo) {
      var to = new Date(f.dateTo + 'T' + (f.timeTo || '23:59')).getTime();
      if (t > to) return false;
    }
    return true;
  }

  function renderFilterTypes() {
    var host = $('filter-types');
    if (!host) return;
    clear(host);
    var tempOn = state.featureFlags.temperatureEnabled;
    var chips = [
      { key: 'all',      label: '전체', temp: false },
      { key: 'critical', label: '심각', temp: false },
      { key: 'warning',  label: '오프라인', temp: false },
      { key: 'hot',      label: '고온', temp: true },
      { key: 'cold',     label: '저온', temp: true },
      { key: 'dry',      label: '건조', temp: true },
      { key: 'humid',    label: '다습', temp: true }
    ];
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].temp && !tempOn) continue;
      (function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'filter-chip tc-' + c.key + (state.filter.typeFilter === c.key ? ' active' : '');
        b.textContent = c.label;
        b.onclick = function () {
          state.filter.typeFilter = c.key;
          renderFilterTypes();
          renderAlarms();
        };
        host.appendChild(b);
      })(chips[i]);
    }
  }

  function renderFilterSystems() {
    var host = $('filter-systems-grid');
    if (!host) return;
    clear(host);
    var types = state.featureFlags.temperatureEnabled ? ['equipment', 'sensor', 'ups'] : ['equipment', 'ups'];
    var labels = { equipment: '장비', sensor: '온습도', ups: 'UPS' };
    var selected = getSelectedSystemsSet();
    var allSystems = [];
    for (var id in state.systemsById) if (Object.prototype.hasOwnProperty.call(state.systemsById, id)) allSystems.push(state.systemsById[id]);
    var allSelected = true, noneSelected = true;
    for (var k = 0; k < allSystems.length; k++) {
      if (Object.prototype.hasOwnProperty.call(selected, allSystems[k].id)) noneSelected = false;
      else allSelected = false;
    }
    var btnAll = $('f-sys-all'); if (btnAll) btnAll.disabled = allSelected || allSystems.length === 0;
    var btnNone = $('f-sys-none'); if (btnNone) btnNone.disabled = noneSelected;

    for (var t = 0; t < types.length; t++) {
      var type = types[t];
      var group = [];
      for (var i = 0; i < allSystems.length; i++) {
        var s = allSystems[i];
        var effType = (s.type === '장비상태') ? 'equipment' : s.type;
        if (effType === type) group.push(s);
      }
      if (group.length === 0) continue;
      group.sort(function (a, b) { var na = a.name || '', nb = b.name || ''; return na < nb ? -1 : (na > nb ? 1 : 0); });
      var col = el('div', 'filter-sys-group');
      col.appendChild(el('h5', null, labels[type] || type));
      var list = el('div', 'filter-sys-list');
      for (var j = 0; j < group.length; j++) {
        (function (sys) {
          var checked = Object.prototype.hasOwnProperty.call(selected, sys.id);
          var row = el('label', 'filter-sys-row' + (checked ? ' checked' : ''));
          var box = el('span', 'filter-sys-checkbox');
          box.innerHTML = SVG.check;
          row.appendChild(box);
          row.appendChild(el('span', 'filter-sys-name', sys.name || ''));
          row.onclick = function (ev) {
            ev.preventDefault();
            var cur = state.filter.selectedSystems;
            if (cur === null) {
              cur = {};
              for (var id in state.systemsById) if (Object.prototype.hasOwnProperty.call(state.systemsById, id)) cur[id] = true;
            } else {
              var copy = {};
              for (var k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) copy[k] = true;
              cur = copy;
            }
            if (cur[sys.id]) delete cur[sys.id]; else cur[sys.id] = true;
            state.filter.selectedSystems = cur;
            renderFilterSystems();
            renderAlarms();
          };
          list.appendChild(row);
        })(group[j]);
      }
      col.appendChild(list);
      host.appendChild(col);
    }
  }

  function renderAlarms() {
    initFilterDefaults();
    renderFilterTypes();
    renderFilterSystems();

    var summaryEl = $('alarm-summary');
    var listEl = $('alarm-list');
    if (!summaryEl || !listEl) return;

    /* Split active vs acknowledged/resolved. Summary counts are unfiltered
     * (match alarms-client.tsx). List sections use filtered views. */
    var tempOn = state.featureFlags.temperatureEnabled;
    var active = [], history = [];
    var critCount = 0, warnCount = 0, ackedCount = 0;
    for (var i = 0; i < state.alarms.length; i++) {
      var a = state.alarms[i];
      /* Respect temperatureEnabled: sensor alarms are excluded from summary counts too */
      if (!tempOn) {
        var asys = a.system || state.systemsById[a.systemId];
        if (asys && asys.type === 'sensor') continue;
      }
      if (!a.acknowledged && !a.resolvedAt) {
        if (a.severity === 'critical') critCount++;
        else if (a.severity === 'warning') warnCount++;
        if (filterAlarm(a)) active.push(a);
      } else {
        ackedCount++;
        if (filterAlarm(a)) history.push(a);
      }
    }

    clear(summaryEl);
    summaryEl.appendChild(summaryItem('crit', SVG.alertCircle, '경고', critCount, 'var(--crit)'));
    summaryEl.appendChild(summaryItem('warn', SVG.alertTriangle, '오프라인', warnCount, 'var(--warn)'));
    summaryEl.appendChild(summaryItem('ack', SVG.checkCircle, '확인됨', ackedCount, 'var(--ok)'));

    clear(listEl);
    if (active.length === 0 && history.length === 0) {
      listEl.appendChild(emptyState('표시할 알람 없음'));
      return;
    }
    if (active.length > 0) {
      var hdr1 = el('div', 'alarm-section-title');
      hdr1.appendChild(document.createTextNode('활성 알람'));
      hdr1.appendChild(el('span', 'alarm-section-count', active.length));
      listEl.appendChild(hdr1);
      for (var j = 0; j < active.length; j++) listEl.appendChild(buildAlarmRow(active[j], false));
    }
    if (history.length > 0) {
      var hdr2 = el('div', 'alarm-section-title');
      hdr2.appendChild(document.createTextNode('알람 이력'));
      var cnt = el('span', 'alarm-section-count ack', history.length);
      hdr2.appendChild(cnt);
      var anyActive = false;
      for (var q = 0; q < state.alarms.length; q++) {
        var aq = state.alarms[q];
        if (!aq.acknowledged && !aq.resolvedAt) { anyActive = true; break; }
      }
      if (anyActive) {
        var ackAll = document.createElement('button');
        ackAll.type = 'button';
        ackAll.className = 'alarm-ackall-btn';
        ackAll.innerHTML = SVG.check + '<span>일괄 확인</span>';
        ackAll.onclick = handleAcknowledgeAll;
        hdr2.appendChild(ackAll);
      }
      listEl.appendChild(hdr2);
      for (var k = 0; k < history.length; k++) listEl.appendChild(buildAlarmRow(history[k], true));
    }
  }

  function handleAcknowledge(alarmId) {
    /* Optimistic update — mirrors alarms-client.tsx handleAcknowledge */
    var target = null;
    for (var i = 0; i < state.alarms.length; i++) {
      if (state.alarms[i].id === alarmId) { target = state.alarms[i]; break; }
    }
    if (!target) return;
    target.acknowledged = true;
    target.acknowledgedAt = new Date();
    renderEquipment(); renderAlarms();

    fetch('/api/alarms/' + encodeURIComponent(alarmId) + '/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgedBy: 'operator' })
    }).then(function (r) { if (!r.ok) throw new Error('ack failed'); return r.json(); })
      .then(function (updated) {
        if (updated && updated.acknowledgedAt) target.acknowledgedAt = new Date(updated.acknowledgedAt);
      })
      .catch(function (e) {
        /* Rollback on failure */
        target.acknowledged = false;
        target.acknowledgedAt = null;
        renderEquipment(); renderAlarms();
        console.error('ack', e);
      });
  }

  function handleAcknowledgeAll() {
    /* Optimistic bulk update — mirrors alarms-client.tsx handleAcknowledgeAll */
    var snapshot = [];
    var now = new Date();
    for (var i = 0; i < state.alarms.length; i++) {
      var a = state.alarms[i];
      if (!a.acknowledged && !a.resolvedAt) {
        snapshot.push(a);
        a.acknowledged = true;
        a.acknowledgedAt = now;
      }
    }
    if (snapshot.length === 0) return;
    renderEquipment(); renderAlarms();

    fetch('/api/alarms/acknowledge-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgedBy: 'operator' })
    }).then(function (r) { if (!r.ok) throw new Error('ackall failed'); return r.json(); })
      .catch(function (e) {
        /* Rollback */
        for (var k = 0; k < snapshot.length; k++) {
          snapshot[k].acknowledged = false;
          snapshot[k].acknowledgedAt = null;
        }
        renderEquipment(); renderAlarms();
        console.error('ackall', e);
      });
  }

  function summaryItem(kind, svgHtml, label, val, color) {
    var wrap = el('div', 'alarm-sum-item ' + kind);
    var ic = el('div', 'alarm-sum-icon');
    ic.style.color = color;
    ic.innerHTML = svgHtml;
    wrap.appendChild(ic);
    var text = el('div');
    text.appendChild(el('div', 'alarm-sum-text-lbl', label));
    text.appendChild(el('div', 'alarm-sum-text-val', String(val)));
    wrap.appendChild(text);
    return wrap;
  }

  function getAlarmTheme(a) {
    if (a.message) {
      if (a.message.indexOf('고온') >= 0) return { label: '고온', cls: 'hot', color: '#ef4444' };
      if (a.message.indexOf('저온') >= 0) return { label: '저온', cls: 'cold', color: '#3b82f6' };
      if (a.message.indexOf('건조') >= 0) return { label: '건조', cls: 'dry', color: '#f97316' };
      if (a.message.indexOf('다습') >= 0) return { label: '다습', cls: 'humid', color: '#06b6d4' };
    }
    if (a.severity === 'critical') return { label: '심각', cls: 'critical', color: '#f87171' };
    return { label: '오프라인', cls: 'warning', color: '#facc15' };
  }

  function getItemName(a) {
    if (!a.message || a.message.indexOf('임계치 초과') < 0) return null;
    var sysName = (a.system && a.system.name) || '';
    var after = sysName ? a.message.replace(sysName + ' ', '') : a.message;
    var itemName = after.replace(' 임계치 초과 상태', '');
    return (itemName !== after && itemName.length > 0) ? itemName : null;
  }

  function buildAlarmRow(a, acked) {
    var theme = getAlarmTheme(a);
    var row = el('div', 'alarm-row ' + (acked ? 'acked' : 'active ' + theme.cls));
    var ic = document.createElement('span');
    ic.className = 'alarm-icon at-' + theme.cls;
    ic.innerHTML = a.severity === 'critical' ? SVG.alertCircle : SVG.alertTriangle;
    ic.style.color = theme.color;
    row.appendChild(ic);
    var labelSpan = el('span', 'alarm-label', theme.label);
    labelSpan.style.color = theme.color;
    row.appendChild(labelSpan);
    if (a.system && a.system.name) row.appendChild(el('span', 'alarm-sys', a.system.name));
    var item = getItemName(a);
    if (item) row.appendChild(el('span', 'alarm-item', item));
    if (a.value) row.appendChild(el('span', 'alarm-value', '(' + a.value + ')'));
    var created = new Date(a.createdAt);
    var timeStr = created.getFullYear() + '.' + pad(created.getMonth() + 1) + '.' + pad(created.getDate()) + ' ' + pad(created.getHours()) + ':' + pad(created.getMinutes());
    row.appendChild(el('span', 'alarm-time', timeStr));
    if (acked) {
      row.appendChild(el('span', 'alarm-ack-label', '확인됨'));
    } else {
      (function (alarmId) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'alarm-ack-btn';
        btn.innerHTML = SVG.check + '<span>확인</span>';
        btn.onclick = function () { handleAcknowledge(alarmId); };
        row.appendChild(btn);
      })(a.id);
    }
    return row;
  }

  /* ============================================================
   *  Utilities
   * ============================================================ */
  function emptyState(msg) { return el('div', 'empty-state', msg); }

  /* ============================================================
   *  Bootstrap
   * ============================================================ */
  function init() {
    renderTopbarIcons();
    tickClock();
    setInterval(tickClock, 1000);
    Promise.all([reloadSystems(), reloadAlarms(), reloadFeatureFlags()]).then(function () { reloadHistory(); });
    wsConnect();
    setInterval(reloadHistory, HISTORY_REFRESH_MS);
    setInterval(reloadSystems, 5 * 60 * 1000);
    var resizeT = null;
    window.addEventListener('resize', function () {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(function () { renderSensorCharts(); renderUpsCharts(); }, 200);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
