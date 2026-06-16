'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'

/**
 * Transient "여기 있습니다" locator overlay for sub-windows.
 *
 * When the user clicks the UPS/온습도 button while that window is ALREADY open, the
 * Rust `open_sub_window` command focuses the window and emits a `window-highlight`
 * event (payload = the window title). This overlay flashes a ring + label for a
 * couple of seconds so the user can immediately spot which window / monitor it is.
 * Rendered only inside standalone sub-windows.
 */
export function WindowHighlightOverlay() {
  const [active, setActive] = useState(false)
  const [label, setLabel] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    ;(async () => {
      let listen: typeof import('@tauri-apps/api/event').listen
      let myLabel = ''
      try {
        ;({ listen } = await import('@tauri-apps/api/event'))
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        myLabel = getCurrentWindow().label
      } catch {
        return // not running inside Tauri
      }
      if (cancelled) return
      try {
        // Payload is [targetLabel, title]; show only if this window is the target,
        // so opening one sub-window doesn't flash the overlay on the others.
        unlisten = await listen<[string, string]>('window-highlight', (event) => {
          const [target, title] = event.payload
          if (target !== myLabel) return
          setLabel(title || '')
          setActive(true)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setActive(false), 2600)
        })
      } catch {
        // window lacks the event capability — overlay simply stays dormant
      }
    })()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-[9999] transition-opacity duration-300 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Pulsing attention ring around the whole window */}
      <div className="absolute inset-0 border-[8px] border-sky-400 animate-pulse shadow-[inset_0_0_80px_rgba(56,189,248,0.5)]" />
      {/* Centered locator label that pops in */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className={`flex items-center gap-4 rounded-2xl bg-sky-500/95 px-10 py-6 text-white shadow-2xl ring-4 ring-sky-300/60 transition-transform duration-300 ${
            active ? 'scale-100' : 'scale-90'
          }`}
        >
          <MapPin className="h-12 w-12 shrink-0 animate-bounce" />
          <div className="text-3xl font-bold leading-tight">{label}</div>
        </div>
      </div>
    </div>
  )
}
