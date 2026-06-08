'use client'

import { useEffect, useState } from 'react'

interface ProcessStatus {
  kind: string // "server" | "worker"
  status: string // "running" | "down"
}

const KIND_LABELS: Record<string, string> = {
  worker: '데이터 수집기',
  server: '웹 서버',
}

/**
 * Shows a banner when the Tauri-supervised worker/server process is down.
 * Listens to the "process-status" event emitted by the Rust supervisor (see
 * src-tauri/src/lib.rs). Renders nothing outside Tauri or while everything is up.
 */
export function IngestionStatusBanner() {
  const [down, setDown] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    ;(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        if (cancelled) return
        // listen() can reject if the window lacks the event capability — keep it
        // inside the try so it degrades to a silent no-op instead of an unhandled
        // rejection (e.g. outside Tauri, or in a window without core:event perms).
        unlisten = await listen<ProcessStatus>('process-status', (event) => {
          const { kind, status } = event.payload
          setDown((prev) => ({ ...prev, [kind]: status === 'down' }))
        })
      } catch {
        // not running inside Tauri, or no event permission for this window — no-op
      }
    })()

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])

  const downKinds = Object.keys(down).filter((k) => down[k])
  if (downKinds.length === 0) return null

  const label = downKinds.map((k) => KIND_LABELS[k] ?? k).join(', ')

  return (
    <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-center text-sm font-medium text-white">
      <span aria-hidden>⚠</span>
      <span>{label} 중단됨 — 자동 재시작 중입니다. 데이터가 갱신되지 않을 수 있습니다.</span>
    </div>
  )
}
