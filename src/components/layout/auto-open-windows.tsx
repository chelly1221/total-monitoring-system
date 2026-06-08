'use client'

import { useEffect } from 'react'

// Module-level guard: persists across client-side (SPA) navigation within the same
// window, but resets on a full page reload. The Rust setup reloads the main window
// ~3s after launch (once the server is up), so this naturally re-runs after the
// reload and opens the sub-windows against a ready server.
let autoOpenAttempted = false

const SUB_WINDOWS = [
  { flag: 'temperatureEnabled', label: 'temperature', title: '온습도 감시', href: '/temperature' },
  { flag: 'upsEnabled', label: 'ups', title: 'UPS 감시', href: '/ups' },
] as const

/**
 * Opens the UPS and 온습도 sub-windows automatically on app launch.
 * Runs only in the main Tauri window (rendered only when !standalone) so the
 * sub-windows themselves never trigger recursive opens. Disabled features
 * (settings flag === 'false') are skipped. Reuses the open_sub_window command,
 * which focuses an existing window instead of creating a duplicate.
 */
export function AutoOpenWindows() {
  useEffect(() => {
    if (autoOpenAttempted) return
    autoOpenAttempted = true

    let cancelled = false

    ;(async () => {
      let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined
      try {
        ;({ invoke } = await import('@tauri-apps/api/core'))
      } catch {
        return // not running inside Tauri — nothing to open
      }
      if (cancelled || !invoke) return

      // Respect feature toggles so we don't pop up windows for disabled features.
      let settings: Record<string, string> = {}
      try {
        settings = await (await fetch('/api/settings')).json()
      } catch {
        // settings unavailable — fall back to opening all sub-windows
      }
      if (cancelled) return

      for (const w of SUB_WINDOWS) {
        if (settings[w.flag] === 'false') continue
        try {
          await invoke('open_sub_window', {
            label: w.label,
            title: w.title,
            path: `${w.href}?standalone=true`,
          })
        } catch {
          // ignore individual window failures
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
