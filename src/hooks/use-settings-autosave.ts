'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createSettingsAutosave } from '@/lib/settings-autosave'

export function useSettingsAutosave() {
  const [queue] = useState(() => createSettingsAutosave<Record<string, string>>(async value => {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      keepalive: true,
    })
    if (!response.ok) throw new Error('Settings save failed')
  }))
  const status = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)

  useEffect(() => {
    const flush = () => { void queue.flush() }
    const leave = () => { void queue.leave() }
    window.addEventListener('online', flush)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('online', flush)
      window.removeEventListener('pagehide', leave)
      void queue.leave()
    }
  }, [queue])

  return { status, schedule: queue.schedule, flush: queue.flush }
}
