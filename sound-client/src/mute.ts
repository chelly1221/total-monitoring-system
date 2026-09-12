// Mute-duration popup (separate Tauri window docked above the tray).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UNMUTE_PRESETS } from "./presets";

interface StateLite {
  unmuteMinutes: number;
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

let defaultMinutes = 10;

function renderGrid(): void {
  const grid = $("popup-grid");
  grid.innerHTML = "";
  for (const p of UNMUTE_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `popup-opt${p.minutes === defaultMinutes ? " default" : ""}`;
    btn.textContent = p.label;
    btn.addEventListener("click", () => {
      void invoke("mute_choose", { minutes: p.minutes });
    });
    grid.appendChild(btn);
  }
}

async function main(): Promise<void> {
  try {
    const s = await invoke<StateLite>("get_state");
    defaultMinutes = s.unmuteMinutes;
  } catch (e) {
    console.error(e);
  }
  renderGrid();

  $("popup-later").addEventListener("click", () => void invoke("mute_popup_dismiss"));
  $("popup-unmute").addEventListener("click", () => void invoke("unmute_now"));

  // Keep the highlighted default in sync when settings change.
  await listen<StateLite>("state", (ev) => {
    if (ev.payload.unmuteMinutes !== defaultMinutes) {
      defaultMinutes = ev.payload.unmuteMinutes;
      renderGrid();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") void invoke("mute_popup_dismiss");
  });
}

void main();
