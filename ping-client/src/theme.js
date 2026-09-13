// Canvas colors come from the same SoundSense palette as the CSS controls.
const styles = getComputedStyle(document.documentElement);
const color = name => styles.getPropertyValue(name).trim();
export const theme = {
  bg: color('--bg'), surface: color('--bg-2'),
  text: color('--text'), text2: color('--text-2'), muted: color('--muted'), idle: color('--idle'),
  accent: color('--accent'), accentTint: color('--accent-tint'),
  danger: color('--danger'), ok: color('--ok'), warn: color('--warn'),
  nodeOkFill: color('--node-ok-fill'), nodeFailedFill: color('--node-failed-fill'),
};
