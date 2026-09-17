// Unmute countdown presets shared by the main window and the tray popup (same as SoundSense).
export const UNMUTE_PRESETS = [
  { minutes: 1, label: '1분' },
  { minutes: 10, label: '10분' },
  { minutes: 30, label: '30분' },
  { minutes: 60, label: '1시간' },
  { minutes: 120, label: '2시간' },
  { minutes: 180, label: '3시간' },
  { minutes: 300, label: '5시간' },
];

export function presetLabel(minutes) {
  const p = UNMUTE_PRESETS.find(x => x.minutes === minutes);
  if (p) return p.label;
  return minutes % 60 === 0 ? `${minutes / 60}시간` : `${minutes}분`;
}

export function formatRemaining(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
