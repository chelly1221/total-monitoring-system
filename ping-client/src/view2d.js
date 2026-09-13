import { theme } from './theme.js';
// renderer/view2d.js — 2D Network Topology View (read-only monitoring)
(function () {
  'use strict';

  let canvas, ctx;
  let active = false;
  let devices = [];
  let connections = [];
  let nodeStatus = {};      // index -> { status, timestamp }
  let ipMap = {};            // ip -> target index
  let targets = [];
  let localIp = '';
  let topology = null;
  let animFrame = null;
  let resizeObs = null;

  // Traffic flow state
  let interNodeData = [];   // [{ src, dst, bytes, packets }]
  let animRunning = false;
  let pathCache = {};
  let adjList = null;

  const REF_W = 800, REF_H = 500;


  function findDev(id) {
    for (let i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  // Get status color for a device based on its target_index
  function getDeviceStatusColor(dev) {
    if (dev.type === 'hub_center') return null;
    if (dev.target_index === undefined || dev.target_index === null) {
      return null; // no target linked
    }
    const t = targets[dev.target_index];
    if (!t || !t.enabled) return theme.idle; // disabled
    const st = nodeStatus[dev.target_index];
    if (!st) return theme.muted; // no data yet
    return st.status === '\uC7A5\uC560' ? theme.danger : st.status === '성공' ? theme.ok : theme.warn;
  }

  // ===== Init =====
  function init() {
    const container = document.getElementById('view2dContainer');
    if (!container) return;
    if (active) return;

    canvas = document.getElementById('view2dCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    active = true;

    resize();

    resizeObs = new ResizeObserver(() => {
      if (active) resize();
    });
    resizeObs.observe(container);

    render();
  }

  function dispose() {
    active = false;
    animRunning = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    canvas = null;
    ctx = null;
    interNodeData = [];
  }

  function resize() {
    if (!canvas || !ctx || !canvas.parentElement) return;
    const wrap = canvas.parentElement;
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
    canvas.style.width = wrap.clientWidth + 'px';
    canvas.style.height = wrap.clientHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Store logical size for coordinate calculations
    canvas._logicalW = wrap.clientWidth;
    canvas._logicalH = wrap.clientHeight;
    render();
  }

  // Override scale helpers to use logical size
  function sxL(v) { return v / REF_W * (canvas._logicalW || canvas.width); }
  function syL(v) { return 16 + v / REF_H * Math.max(1, (canvas._logicalH || canvas.height) - 104); }

  function setTargets(t, map) {
    targets = t || [];
    ipMap = map || {};
    nodeStatus = {};
    rebuildFromTopology();
    scheduleRender();
  }

  function setTopology(topo) {
    topology = topo;
    rebuildFromTopology();
    scheduleRender();
  }

  function rebuildFromTopology() {
    pathCache = {};
    adjList = null;
    if (topology && topology.devices && topology.devices.length > 0) {
      devices = JSON.parse(JSON.stringify(topology.devices));
      connections = JSON.parse(JSON.stringify(topology.connections || []));
    } else {
      autoGenerate();
    }
  }

  function autoGenerate() {
    devices = [{ id: 'dev_hub', type: 'hub_center', name: '\uB124\uD2B8\uC6CC\uD06C \uAC10\uC2DCPC', ip: '', x: REF_W / 2, y: REF_H / 2 }];
    connections = [];
    const activeTargets = [];
    (targets || []).forEach(function (t, i) {
      if (t.name && t.address) activeTargets.push({ name: t.name, address: t.address, type: t.type || 'pc', realIdx: i });
    });
    const cx = REF_W / 2, cy = REF_H / 2, radius = Math.min(REF_W, REF_H) * 0.35;
    activeTargets.forEach(function (t, i) {
      const angle = (i / Math.max(activeTargets.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const id = 'auto_' + i;
      devices.push({
        id: id, type: t.type, name: t.name, ip: t.address,
        target_index: t.realIdx,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius
      });
      connections.push({ from: 'dev_hub', to: id });
    });
  }

  // ===== Rendering =====
  function render() {
    if (!ctx || !canvas || !canvas._logicalW) return;
    const w = canvas._logicalW, h = canvas._logicalH;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Connections
    for (let ci = 0; ci < connections.length; ci++) drawConn(connections[ci]);

    // Traffic flow particles
    renderTrafficFlows();

    // Devices (drawn on top of flow lines)
    for (let di = 0; di < devices.length; di++) drawDev(devices[di]);

    // Empty state
    if (devices.length <= 1 && targets.filter(t => t.name && t.address).length === 0) {
      ctx.fillStyle = theme.text2;
      ctx.font = '14px Pretendard, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('\uAC10\uC2DC\uB300\uC0C1\uC744 \uCD94\uAC00\uD558\uBA74 \uD1A0\uD3F4\uB85C\uC9C0\uAC00 \uD45C\uC2DC\uB429\uB2C8\uB2E4', w / 2, h / 2);
    }
  }

  function drawConn(conn) {
    const from = findDev(conn.from), to = findDev(conn.to);
    if (!from || !to) return;
    const fx = sxL(from.x), fy = syL(from.y);
    const tx = sxL(to.x), ty = syL(to.y);

    // Status-based line color
    const toColor = to.type === 'hub_center' ? null : getDeviceStatusColor(to);
    const fromColor = from.type === 'hub_center' ? null : getDeviceStatusColor(from);
    const failed = toColor === theme.danger || fromColor === theme.danger;
    let lineColor = theme.idle;
    if (failed) {
      lineColor = theme.danger;
    } else if (toColor === theme.ok || fromColor === theme.ok) {
      lineColor = theme.ok;
    }

    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.setLineDash(failed ? [7, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawDev(dev) {
    const x = sxL(dev.x), y = syL(dev.y);
    const size = dev.size || 1;
    const scale = Math.max(0.7, Math.min(2, size));
    const statusColor = getDeviceStatusColor(dev);
    const healthy = statusColor === theme.ok;
    const failed = statusColor === theme.danger;
    const measured = healthy || failed;
    const ink = measured ? statusColor : theme.text2;
    const halfW = 32 * scale, halfH = 27 * scale;

    ctx.save();
    rRect(x - halfW, y - halfH, halfW * 2, halfH * 2, 9 * scale);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    if (measured) {
      ctx.fillStyle = healthy ? theme.nodeOkFill : theme.nodeFailedFill;
      ctx.fill();
    }
    ctx.strokeStyle = measured ? hexWithAlpha(statusColor, 0.55) : '#c9cccf';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Consistent line icons retain the equipment type without becoming solid blocks.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dev.type === 'server') {
      for (const dy of [-10, 0, 10]) {
        rRect(-12, dy - 4, 24, 8, 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(6, dy); ctx.lineTo(8, dy); ctx.stroke();
      }
    } else if (dev.type === 'switch') {
      rRect(-17, -8, 34, 16, 3); ctx.stroke();
      for (let dx = -10; dx <= 10; dx += 7) {
        rRect(dx - 2, -1, 4, 5, 0.6); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-11, -4); ctx.lineTo(-9, -4); ctx.stroke();
    } else if (dev.type === 'router') {
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
      for (let angle = 0; angle < 4; angle++) {
        ctx.save(); ctx.rotate(angle * Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(10, 0);
        ctx.moveTo(7, -3); ctx.lineTo(10, 0); ctx.lineTo(7, 3); ctx.stroke();
        ctx.restore();
      }
    } else if (dev.type === 'hub_center') {
      rRect(-7, -15, 14, 10, 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 3);
      ctx.moveTo(-13, 8); ctx.lineTo(-13, 3); ctx.lineTo(13, 3); ctx.lineTo(13, 8); ctx.stroke();
      for (const dx of [-13, 13]) { rRect(dx - 6, 8, 12, 9, 2); ctx.stroke(); }
    } else {
      rRect(-16, -12, 32, 22, 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-16, 5); ctx.lineTo(16, 5);
      ctx.moveTo(0, 10); ctx.lineTo(0, 16); ctx.moveTo(-7, 16); ctx.lineTo(7, 16); ctx.stroke();
    }
    ctx.restore();

    // A check or exclamation mark makes status legible without relying on hue alone.
    if (measured) {
      const bx = x + halfW - 2, by = y - halfH + 2;
      ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fillStyle = statusColor; ctx.fill();
      ctx.strokeStyle = theme.bg; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      if (healthy) { ctx.moveTo(bx - 3, by); ctx.lineTo(bx - 0.5, by + 2.5); ctx.lineTo(bx + 3.5, by - 2.5); }
      else { ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 0.5); ctx.moveTo(bx, by + 3.5); ctx.lineTo(bx, by + 3.6); }
      ctx.stroke();
    }
    const nameY = y + halfH + 20;
    ctx.textAlign = 'center';
    ctx.font = '600 13px Pretendard, sans-serif';
    ctx.fillStyle = theme.text;
    drawLabel(dev.name, x, nameY);
    if (dev.ip) {
      ctx.font = '11px Consolas, monospace'; ctx.fillStyle = theme.text2;
      drawLabel(dev.ip, x, nameY + 16);
    }
    const target = targets[dev.target_index];
    const state = nodeStatus[dev.target_index];
    if (target) {
      const label = !target.enabled ? '비활성' : state?.status === '성공' ? '정상' : state?.status || '대기';
      ctx.font = '600 11px Pretendard, sans-serif';
      ctx.fillStyle = measured ? statusColor : theme.text2;
      drawLabel(label, x, nameY + (dev.ip ? 32 : 16));
    }
    ctx.restore();
  }

  // Keep connection lines from crossing device labels.
  function drawLabel(text, x, y) {
    const metrics = ctx.measureText(text);
    const ink = ctx.fillStyle;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x - metrics.width / 2 - 3, y - metrics.actualBoundingBoxAscent - 2,
      metrics.width + 6, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 4);
    ctx.fillStyle = ink;
    ctx.fillText(text, x, y);
  }

  function rRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function hexWithAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ===== Batched Rendering =====
  function scheduleRender() {
    if (animRunning) return; // animation loop handles rendering
    if (animFrame) return;
    animFrame = requestAnimationFrame(() => {
      animFrame = null;
      render();
    });
  }

  // ===== Status Updates =====
  function updateNodeStatus(index, status, timestamp) {
    nodeStatus[index] = { status, timestamp };
    scheduleRender();
  }

  // ===== Traffic Flow Animation =====

  function handleInterNodeStats(data) {
    interNodeData = data || [];
    ensureAnimation();
  }

  function hasActiveFlows() { return interNodeData.length > 0; }

  function ensureAnimation() {
    if (hasActiveFlows() && !animRunning && active) {
      animRunning = true;
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      animFrame = requestAnimationFrame(animTick);
    }
  }

  function animTick(now) {
    if (!animRunning || !active || !ctx) {
      animRunning = false;
      animFrame = null;
      return;
    }
    render();
    if (hasActiveFlows()) {
      animFrame = requestAnimationFrame(animTick);
    } else {
      animRunning = false;
      animFrame = null;
    }
  }

  // ===== Graph Shortest Path (BFS) =====

  function buildAdjListIfNeeded() {
    if (adjList) return;
    adjList = {};
    for (let i = 0; i < devices.length; i++) adjList[devices[i].id] = [];
    for (let i = 0; i < connections.length; i++) {
      const c = connections[i];
      if (adjList[c.from]) adjList[c.from].push(c.to);
      if (adjList[c.to]) adjList[c.to].push(c.from);
    }
  }

  function findPath(fromId, toId) {
    if (fromId === toId) return null;
    const key = fromId + '|' + toId;
    if (key in pathCache) return pathCache[key];
    buildAdjListIfNeeded();

    const visited = {};
    visited[fromId] = true;
    const queue = [[fromId]];
    while (queue.length > 0) {
      const path = queue.shift();
      const node = path[path.length - 1];
      if (node === toId) {
        pathCache[key] = path;
        return path;
      }
      const neighbors = adjList[node];
      if (!neighbors) continue;
      for (let i = 0; i < neighbors.length; i++) {
        if (!visited[neighbors[i]]) {
          visited[neighbors[i]] = true;
          queue.push(path.concat(neighbors[i]));
        }
      }
    }
    pathCache[key] = null;
    return null;
  }

  // ===== Traffic Flow Rendering =====

  function renderTrafficFlows() {
    if (!hasActiveFlows()) return;
    const t = performance.now() / 1000;

    // Build IP -> device map
    const ipToDev = {};
    for (let i = 0; i < devices.length; i++) {
      if (devices[i].ip) ipToDev[devices[i].ip] = devices[i];
    }
    // Map localIp to hub_center
    const hubDev = devices.find(function (d) { return d.type === 'hub_center'; });
    if (localIp && hubDev) ipToDev[localIp] = hubDev;

    // 1. Inter-node flows (registered device ↔ registered device)
    for (let i = 0; i < interNodeData.length; i++) {
      const flow = interNodeData[i];
      const srcDev = ipToDev[flow.src];
      const dstDev = ipToDev[flow.dst];
      if (!srcDev || !dstDev) continue;
      // Skip flows involving hub_center
      if (srcDev.type === 'hub_center' || dstDev.type === 'hub_center') continue;

      const path = findPath(srcDev.id, dstDev.id);
      if (!path || path.length < 2) continue;

      var count = Math.max(1, Math.min(5, Math.ceil(Math.log2(flow.bytes / 500 + 1))));
      var speed = 0.4;

      for (let p = 0; p < count; p++) {
        var phase = ((t * speed + p / count) % 1 + 1) % 1;
        drawPathParticle(path, phase, 'rgba(127,13,0,0.85)', Math.min(4, 2 + flow.bytes / 30000));
      }
    }

  }

  function drawPathParticle(pathIds, phase, color, size) {
    const segments = pathIds.length - 1;
    const pos = phase * segments;
    const segIdx = Math.min(Math.floor(pos), segments - 1);
    const segT = pos - segIdx;

    const from = findDev(pathIds[segIdx]);
    const to = findDev(pathIds[segIdx + 1]);
    if (!from || !to) return;

    const x = sxL(from.x + (to.x - from.x) * segT);
    const y = syL(from.y + (to.y - from.y) * segT);
    const r = Math.max(2, size);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Passthrough handlers (no-op for unused traffic data)
  function handleTrafficStats() {}
  function handleAsterixFlows() {}

  // ===== Export =====
  window.view2d = {
    init, dispose, setTargets, setTopology, updateNodeStatus,
    handleTrafficStats, handleInterNodeStats,
    handleAsterixFlows,
    setIpMap: function (m) { ipMap = m; },
    setLocalIp: function (ip) { localIp = ip; },
    isActive: function () { return active; },
    render: render
  };
})();
