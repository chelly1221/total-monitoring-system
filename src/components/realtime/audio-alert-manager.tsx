'use client'

import { useEffect, useRef } from 'react'
import { useRealtime } from './realtime-provider'
import { evaluateDisplayItemStatus } from '@/lib/threshold-evaluator'
import type { AudioConfig, MetricsConfig } from '@/types'

export function AudioAlertManager() {
  const { alarms, systems, metrics, audioMuted, serverAudioEnabled } = useRealtime()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentFileRef = useRef<string | null>(null)

  useEffect(() => {
    // Only the installed server app obeys the desktop output setting.
    const serverOutputBlocked = '__TAURI_INTERNALS__' in window && serverAudioEnabled !== true
    if (audioMuted || serverOutputBlocked) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
        currentFileRef.current = null
      }
      return
    }

    // Find active critical alarms: unresolved AND unacknowledged
    const activeCritical = alarms.filter(
      (a) => a.severity === 'critical' && !a.resolvedAt && !a.acknowledged
    )

    if (activeCritical.length > 0) {
      // Find the first alarm that has a valid audio file configured
      let targetFile: string | null = null
      for (const alarm of activeCritical) {
        const system = systems.find((s) => s.id === alarm.systemId)
        if (!system || !system.isEnabled || !system.isActive) continue

        // Sensor & UPS systems: check per-item audio based on current metric values
        if ((system.type === 'sensor' || system.type === 'ups') && system.config) {
          try {
            const metricsConfig = JSON.parse(system.config) as MetricsConfig
            if (metricsConfig.displayItems) {
              for (const item of metricsConfig.displayItems) {
                if (!item.audioConfig || item.audioConfig.type !== 'file' || !item.audioConfig.fileName) continue

                // Find matching metric for this display item
                const metric = metrics.find(
                  (m) => m.systemId === system.id && m.name === item.name
                )
                if (!metric) continue

                // Check if this specific metric is currently in critical state
                const isCritical = evaluateDisplayItemStatus(metric, item) === 'critical'

                if (isCritical) {
                  targetFile = item.audioConfig.fileName
                  break
                }
              }
            }
          } catch {
            // Invalid config, skip
          }
          if (targetFile) break
          // Sensor: no system-level fallback
          if (system.type === 'sensor') continue
          // UPS: fall through to system-level audioConfig as fallback
        }

        // Non-sensor systems (+ UPS fallback): use system-level audioConfig
        if (!system.audioConfig) continue
        try {
          const config = JSON.parse(system.audioConfig) as AudioConfig
          if (config.type === 'file' && config.fileName) {
            targetFile = config.fileName
            break
          }
        } catch {
          continue
        }
      }

      if (targetFile) {
        // Already playing (or starting) this file — skip
        if (currentFileRef.current === targetFile && audioRef.current) {
          return
        }

        // Stop any currently playing audio first
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.src = ''
          audioRef.current = null
        }

        // Mark intent before async play to prevent duplicates
        currentFileRef.current = targetFile
        const audio = new Audio(`/api/audio/${targetFile}`)
        audio.loop = true
        audio.play().catch(() => {
          // Browser may block autoplay without user interaction — silently ignore
        })
        audioRef.current = audio
      } else {
        // Active critical alarms exist but none have audio configured — stop if playing
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current.src = ''
          audioRef.current = null
          currentFileRef.current = null
        }
      }
    } else {
      // No active critical alarms — stop audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
        currentFileRef.current = null
      }
    }
  }, [alarms, systems, metrics, audioMuted, serverAudioEnabled])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
    }
  }, [])

  return null
}
