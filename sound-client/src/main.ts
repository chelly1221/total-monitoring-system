import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { UNMUTE_PRESETS, presetLabel } from "./presets";

interface Target {
  ip: string;
  port: number;
}

interface Settings {
  id: string;
  name: string;
  target: Target | null;
  on: string;
  off: string;
  intervalMs: number;
  threshold: number;
  silenceMs: number;
  discoveryPort: number;
  unmuteMinutes: number;
  autostart: boolean;
}

interface Snapshot {
  sound: boolean;
  peak: number;
  muted: boolean;
  unmuteRemainingSec: number | null;
  target: Target | null;
  lastSentMs: number | null;
  sendCount: number;
  name: string;
  host: string;
  localIp: string;
  id: string;
  version: string;
  uptimeSec: number;
  audioStatus: string;
  discoveryStatus: string;
  unmuteMinutes: number;
  transferStatus: string;
}

const NO_TARGET_TEXT = "서버 미등록 (서버에서 자동탐지로 추가하세요)";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatRemaining(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fillPresetSelect(select: HTMLSelectElement, current: number): void {
  const values = UNMUTE_PRESETS.map((p) => p.minutes);
  if (!values.includes(current)) values.push(current);
  values.sort((a, b) => a - b);
  select.innerHTML = "";
  for (const m of values) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = presetLabel(m);
    select.appendChild(opt);
  }
  select.value = String(current);
}

// ------------------------------------------------------------------ titlebar

function setupTitlebar(): void {
  const win = getCurrentWindow();
  $("btn-min").addEventListener("click", () => void win.minimize());
  // Close hides to the tray (the Rust CloseRequested handler prevents exit).
  $("btn-close").addEventListener("click", () => void win.close());
}

// ------------------------------------------------------------------ tabs

function setupTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll<HTMLElement>(".view").forEach((v) => {
        v.classList.toggle("active", v.id === `view-${btn.dataset.tab}`);
      });
    });
  });
}

// ------------------------------------------------------------------ status

let lastSnapshot: Snapshot | null = null;
let gridDefault = -1;

function renderMuteGrid(defaultMinutes: number): void {
  if (gridDefault === defaultMinutes) return;
  gridDefault = defaultMinutes;
  const grid = $("mute-grid");
  grid.innerHTML = "";
  for (const p of UNMUTE_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `popup-opt${p.minutes === defaultMinutes ? " default" : ""}`;
    btn.textContent = p.label;
    btn.title = "이 시간 뒤에 음소거를 자동 해제합니다 (음소거 상태일 때만)";
    btn.addEventListener("click", () => void invoke("mute_choose", { minutes: p.minutes }));
    grid.appendChild(btn);
  }
}

function renderStatus(s: Snapshot): void {
  lastSnapshot = s;
  $("st-ver").textContent = `v${s.version}`;

  const ind = $("indicator");
  ind.classList.toggle("on", s.sound);
  $("indicator-label").textContent = s.sound ? "소리 감지" : "무음";
  $("indicator-peak").textContent = `피크 ${s.peak.toFixed(3)}`;
  const pct = Math.min(100, Math.round(Math.sqrt(Math.min(1, s.peak)) * 100));
  $("meter-fill").style.width = `${pct}%`;

  const chipServer = $("chip-server");
  if (s.target) {
    chipServer.textContent = `서버 ${s.target.ip}:${s.target.port}`;
    chipServer.className = "chip ok";
  } else {
    chipServer.textContent = "서버 미등록";
    chipServer.className = "chip warn";
  }
  const chipMute = $("chip-mute");
  if (s.muted) {
    chipMute.textContent = s.unmuteRemainingSec !== null
      ? `음소거됨 · ${formatRemaining(s.unmuteRemainingSec)} 후 해제`
      : "음소거됨";
    chipMute.className = "chip accent";
  } else {
    chipMute.textContent = "음소거 아님";
    chipMute.className = "chip";
  }

  const chipTransfer = $("chip-transfer");
  chipTransfer.textContent = s.transferStatus;
  chipTransfer.classList.toggle("hidden", !s.transferStatus);

  const muteEl = $("mute-state");
  muteEl.textContent = s.muted ? "음소거됨" : "정상 (음소거 아님)";
  muteEl.className = `v ${s.muted ? "warn" : "ok"}`;
  const running = s.muted && s.unmuteRemainingSec !== null;
  $("mute-remaining").textContent = running
    ? formatRemaining(s.unmuteRemainingSec as number)
    : s.muted ? "타이머 없음" : "-";
  renderMuteGrid(s.unmuteMinutes);
  $<HTMLButtonElement>("btn-cancel-timer").disabled = !running;

  const targetEl = $("target");
  if (s.target) {
    targetEl.textContent = `${s.target.ip}:${s.target.port}`;
    targetEl.className = "v mono";
  } else {
    targetEl.textContent = NO_TARGET_TEXT;
    targetEl.className = "v warn";
  }
  $("last-sent").textContent = s.lastSentMs ? formatTime(s.lastSentMs) : "-";
  $("send-count").textContent = String(s.sendCount);

  $("st-name").textContent = s.name || "(미등록)";
  $("st-host").textContent = s.host || "-";
  $("st-ip").textContent = s.localIp || "-";
  $("st-id").textContent = s.id;
  $("st-audio").textContent = s.audioStatus;
  $("st-discovery").textContent = s.discoveryStatus;
}

function setupStatusActions(): void {
  renderMuteGrid(10);
  $("btn-cancel-timer").addEventListener("click", () => void invoke("mute_cancel"));
  $("btn-unmute").addEventListener("click", () => void invoke("unmute_now"));
}

// ------------------------------------------------------------------ settings

function setMsg(id: string, text: string, kind: "" | "error" | "ok" = ""): void {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${kind}`.trim();
}

type FieldEl = HTMLInputElement | HTMLSelectElement;

/** Settings inputs live in two tabs (설정 / 서버); look them up by name across both. */
function fields(): Record<string, FieldEl> {
  const out: Record<string, FieldEl> = {};
  document
    .querySelectorAll<FieldEl>("#view-settings [name], #view-server [name]")
    .forEach((el) => (out[el.name] = el));
  return out;
}

function fillSettingsForm(s: Settings): void {
  const f = fields();
  f.name.value = s.name;
  f.threshold.value = String(s.threshold);
  f.silenceMs.value = String(s.silenceMs);
  f.intervalMs.value = String(s.intervalMs);
  fillPresetSelect(f.unmuteMinutes as HTMLSelectElement, s.unmuteMinutes);
  f.discoveryPort.value = String(s.discoveryPort);
  (f.autostart as HTMLInputElement).checked = s.autostart;
  f.targetIp.value = s.target?.ip ?? "";
  f.targetPort.value = s.target ? String(s.target.port) : "";
  f.on.value = s.on;
  f.off.value = s.off;

  const t = $("settings-target");
  if (s.target) {
    t.textContent = `${s.target.ip}:${s.target.port} (${s.on} / ${s.off})`;
    t.className = "v ok";
    $("settings-target-hint").textContent = "서버 자동탐지로 설정된 값입니다. 필요할 때만 직접 바꾸세요.";
  } else {
    t.textContent = "미등록";
    t.className = "v warn";
    $("settings-target-hint").textContent = "서버에서 자동탐지로 이 PC를 선택하면 자동 설정됩니다. 필요할 때만 직접 입력하세요.";
  }
}

function readSettingsForm(base: Settings): Settings {
  const f = fields();
  const ip = f.targetIp.value.trim();
  const port = Number(f.targetPort.value);
  const target: Target | null = ip && port > 0 ? { ip, port } : null;
  return {
    ...base,
    name: f.name.value.trim(),
    threshold: Number(f.threshold.value),
    silenceMs: Number(f.silenceMs.value),
    intervalMs: Number(f.intervalMs.value),
    unmuteMinutes: Number(f.unmuteMinutes.value),
    discoveryPort: Number(f.discoveryPort.value),
    autostart: (f.autostart as HTMLInputElement).checked,
    target,
    on: f.on.value.trim() || base.on,
    off: f.off.value.trim() || base.off,
  };
}

let currentSettings: Settings | null = null;

async function loadSettings(): Promise<Settings> {
  const s = await invoke<Settings>("get_settings");
  currentSettings = s;
  fillSettingsForm(s);
  return s;
}

function setupSettingsForm(): void {
  // Both tabs save the whole settings object; the message shows on the tab that was used.
  const save = async (msgId: string) => {
    if (!currentSettings) return;
    const invalid = Object.values(fields()).find((el) => el instanceof HTMLInputElement && !el.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    const next = readSettingsForm(currentSettings);
    try {
      const saved = await invoke<Settings>("save_settings", { settings: next });
      currentSettings = saved;
      fillSettingsForm(saved);
      setMsg(msgId, "저장했습니다", "ok");
      setTimeout(() => setMsg(msgId, ""), 2500);
    } catch (e) {
      setMsg(msgId, String(e), "error");
    }
  };
  document.querySelectorAll<HTMLButtonElement>(".btn-save").forEach((btn) => {
    const msgId = btn.closest("#view-server") ? "server-msg" : "settings-msg";
    btn.addEventListener("click", () => void save(msgId));
  });
  document.querySelectorAll<HTMLInputElement>("#view-settings input, #view-server input").forEach((el) => {
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") void save(el.closest("#view-server") ? "server-msg" : "settings-msg");
    });
  });
  $("btn-clear-target").addEventListener("click", () => {
    const f = fields();
    f.targetIp.value = "";
    f.targetPort.value = "";
  });
}

// ------------------------------------------------------------------ name modal

let nameModalOpen = false;

function showNameModal(): void {
  nameModalOpen = true;
  $("name-modal").classList.remove("hidden");
  const input = $<HTMLInputElement>("name-input");
  setTimeout(() => input.focus(), 50);
}

function hideNameModal(): void {
  nameModalOpen = false;
  $("name-modal").classList.add("hidden");
}

function setupNameModal(): void {
  const form = $<HTMLFormElement>("name-form");
  const input = $<HTMLInputElement>("name-input");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (!name) {
      setMsg("name-msg", "장비명을 입력하세요", "error");
      input.focus();
      return;
    }
    if (!currentSettings) currentSettings = await invoke<Settings>("get_settings");
    try {
      const saved = await invoke<Settings>("save_settings", { settings: { ...currentSettings, name } });
      currentSettings = saved;
      fillSettingsForm(saved);
      setMsg("name-msg", "");
      hideNameModal();
    } catch (e) {
      setMsg("name-msg", String(e), "error");
    }
  });
  // Escape must not dismiss the dialog while the name is empty.
  document.addEventListener("keydown", (ev) => {
    if (nameModalOpen && ev.key === "Escape") ev.preventDefault();
  });
}

// ------------------------------------------------------------------ identify banner

let identifyTimer: number | null = null;

function showIdentify(sec: number): void {
  const banner = $("identify-banner");
  const count = $("identify-count");
  $("identify-name").textContent = lastSnapshot
    ? `${lastSnapshot.name || "(장비명 미등록)"} · ${lastSnapshot.host}`
    : "";
  banner.classList.remove("hidden");
  let remaining = Math.max(1, Math.floor(sec));
  count.textContent = String(remaining);
  if (identifyTimer !== null) window.clearInterval(identifyTimer);
  identifyTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      banner.classList.add("hidden");
      if (identifyTimer !== null) window.clearInterval(identifyTimer);
      identifyTimer = null;
      return;
    }
    count.textContent = String(remaining);
  }, 1000);
}

// ------------------------------------------------------------------ boot

async function main(): Promise<void> {
  setupTitlebar();
  setupTabs();
  setupStatusActions();
  setupSettingsForm();
  setupNameModal();

  await listen<Snapshot>("state", (ev) => renderStatus(ev.payload));
  await listen<Settings>("settings-changed", (ev) => {
    currentSettings = ev.payload;
    fillSettingsForm(ev.payload);
    if (ev.payload.name.trim() && nameModalOpen) hideNameModal();
  });
  await listen<{ sec: number }>("identify", (ev) => showIdentify(ev.payload.sec));

  try {
    renderStatus(await invoke<Snapshot>("get_state"));
    const s = await loadSettings();
    if (!s.name.trim()) showNameModal();
  } catch (e) {
    console.error("init failed", e);
  }
}

void main();
