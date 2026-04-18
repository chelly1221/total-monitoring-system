'use client'

import { createContext, useContext, useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'
import type {
  PrismaSystem,
  PrismaMetric,
  PrismaAlarm,
  WebSocketMessage,
} from '@/types'

interface FeatureFlags {
  temperatureEnabled: boolean
  upsEnabled: boolean
  gateEnabled: boolean
}

const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  temperatureEnabled: true,
  upsEnabled: true,
  gateEnabled: true,
}

function parseFeatureFlags(settings: Record<string, string>): FeatureFlags {
  return {
    temperatureEnabled: settings.temperatureEnabled !== 'false',
    upsEnabled: settings.upsEnabled !== 'false',
    gateEnabled: settings.gateEnabled !== 'false',
  }
}

interface RealtimeContextValue {
  systems: PrismaSystem[]
  metrics: PrismaMetric[]
  alarms: PrismaAlarm[]
  connected: boolean
  reconnecting: boolean
  lastUpdate: Date | null
  audioMuted: boolean
  muteEndTime: number | null
  featureFlags: FeatureFlags
  setAudioMute: (muted: boolean, endTime?: number | null) => void
  updateSystem: (systemId: string, updates: Partial<PrismaSystem>) => void
  updateMetric: (metricId: string, updates: Partial<PrismaMetric>) => void
  addAlarm: (alarm: PrismaAlarm) => void
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

interface RealtimeProviderProps {
  children: React.ReactNode
  initialSystems: PrismaSystem[]
  initialAlarms: PrismaAlarm[]
}

export function RealtimeProvider({
  children,
  initialSystems,
  initialAlarms,
}: RealtimeProviderProps) {
  const [systems, setSystems] = useState<PrismaSystem[]>(initialSystems)
  const [alarms, setAlarms] = useState<PrismaAlarm[]>(initialAlarms)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [audioMuted, setAudioMuted] = useState(false)
  const [muteEndTime, setMuteEndTime] = useState<number | null>(null)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(DEFAULT_FEATURE_FLAGS)

  // Ref to avoid handleMessage depending on systems state (prevents recreation on every metric update)
  const systemsRef = useRef<PrismaSystem[]>(initialSystems)
  systemsRef.current = systems

  // Extract all metrics from systems (memoized to prevent child re-renders)
  const metrics = useMemo(() => systems.flatMap((s) => s.metrics ?? []), [systems])

  const updateSystem = useCallback((systemId: string, updates: Partial<PrismaSystem>) => {
    setSystems((prev) =>
      prev.map((s) => (s.id === systemId ? { ...s, ...updates } : s))
    )
    setLastUpdate(new Date())
  }, [])

  const updateMetric = useCallback((metricId: string, updates: Partial<PrismaMetric>) => {
    setSystems((prev) =>
      prev.map((system) => ({
        ...system,
        metrics: system.metrics?.map((m) =>
          m.id === metricId ? { ...m, ...updates } : m
        ),
      }))
    )
    setLastUpdate(new Date())
  }, [])

  const addAlarm = useCallback((alarm: PrismaAlarm) => {
    setAlarms((prev) => [alarm, ...prev].slice(0, 100)) // Keep max 100 alarms
    setLastUpdate(new Date())
  }, [])

  const removeSystem = useCallback((systemId: string) => {
    setSystems((prev) => prev.filter((s) => s.id !== systemId))
    setAlarms((prev) => prev.filter((a) => a.systemId !== systemId))
    setLastUpdate(new Date())
  }, [])

  const setAudioMute = useCallback((muted: boolean, endTime?: number | null) => {
    setAudioMuted(muted)
    setMuteEndTime(endTime ?? null)
  }, [])

  // Fetch initial audio mute state and feature flags from settings
  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((settings) => {
        const enabled = settings.audioEnabled !== 'false'
        if (!enabled) {
          const end = settings.muteEndTime ? parseInt(settings.muteEndTime) : 0
          if (!end || end > Date.now()) {
            setAudioMuted(true)
            setMuteEndTime(end || null)
          }
        }
        setFeatureFlags(parseFeatureFlags(settings))
      })
      .catch(() => {})
  }, [])

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      const { type, data } = message

      switch (type) {
        case 'metric':
          if (data.metricId && data.value !== undefined) {
            updateMetric(data.metricId, {
              value: data.value,
              textValue: data.textValue ?? null,
              trend: data.trend ?? null,
              updatedAt: new Date(),
            })
          }
          break

        case 'system':
          if (data.systemId && data.status) {
            updateSystem(data.systemId, {
              status: data.status,
              updatedAt: new Date(),
            })
            // 정상 복귀 시 해당 시스템의 미해결 알람도 정리 (alarm-resolved 놓침 대비)
            if (data.status === 'normal') {
              setAlarms((prev) =>
                prev.filter((a) => a.systemId !== data.systemId || a.resolvedAt !== null)
              )
              setLastUpdate(new Date())
            }
          }
          break

        case 'alarm':
          // 단일 알람 확인 처리
          if (data.acknowledged && data.alarmId && !data.severity) {
            setAlarms((prev) =>
              prev.map((a) =>
                a.id === data.alarmId
                  ? { ...a, acknowledged: true, acknowledgedAt: new Date(message.timestamp) }
                  : a
              )
            )
            setLastUpdate(new Date())
            break
          }

          // 일괄 알람 확인 처리
          if (data.acknowledged && data.bulk && data.alarmIds) {
            const acknowledgedIds = new Set(data.alarmIds as string[])
            setAlarms((prev) =>
              prev.map((a) =>
                acknowledgedIds.has(a.id)
                  ? { ...a, acknowledged: true, acknowledgedAt: new Date(message.timestamp) }
                  : a
              )
            )
            setLastUpdate(new Date())
            break
          }

          // 새 알람 추가 (기존 로직)
          if (data.alarmId && data.severity && data.message && data.systemId) {
            const newAlarm: PrismaAlarm = {
              id: data.alarmId,
              systemId: data.systemId,
              severity: data.severity,
              message: data.message,
              value: data.alarmValue ?? null,
              acknowledged: data.acknowledged ?? false,
              acknowledgedAt: null,
              acknowledgedBy: null,
              createdAt: new Date(message.timestamp),
              resolvedAt: null,
              system: systemsRef.current.find((s) => s.id === data.systemId),
            }
            addAlarm(newAlarm)
          }
          break

        case 'ping':
          // Connection keepalive, no action needed
          break

        case 'delete':
          if (data.systemId) {
            removeSystem(data.systemId)
          }
          break

        case 'alarm-resolved':
          if (data.systemId) {
            if (data.alarmIds && Array.isArray(data.alarmIds)) {
              // Partial resolution: remove specific resolved alarms from state
              const ids = new Set(data.alarmIds as string[])
              setAlarms((prev) => prev.filter((a) => !ids.has(a.id)))
            } else {
              // Full resolution: remove all unresolved for system
              setAlarms((prev) =>
                prev.filter((a) => a.systemId !== data.systemId || a.resolvedAt !== null)
              )
            }
            setLastUpdate(new Date())
          }
          break

        case 'settings':
          if (data.audioEnabled !== undefined) {
            const enabled = data.audioEnabled !== 'false'
            const end = data.muteEndTime ? parseInt(data.muteEndTime) : 0
            if (enabled) {
              setAudioMuted(false)
              setMuteEndTime(null)
            } else {
              setAudioMuted(true)
              setMuteEndTime(end || null)
            }
          }
          if (data.temperatureEnabled !== undefined || data.upsEnabled !== undefined || data.gateEnabled !== undefined) {
            setFeatureFlags((prev) => ({
              temperatureEnabled: data.temperatureEnabled !== undefined ? data.temperatureEnabled !== 'false' : prev.temperatureEnabled,
              upsEnabled: data.upsEnabled !== undefined ? data.upsEnabled !== 'false' : prev.upsEnabled,
              gateEnabled: data.gateEnabled !== undefined ? data.gateEnabled !== 'false' : prev.gateEnabled,
            }))
          }
          break

        default:
          console.log('[realtime] Unknown message type:', type)
      }
    },
    [updateMetric, updateSystem, addAlarm, removeSystem]
  )

  // WebSocket 재연결 시 전체 상태 동기화
  const syncState = useCallback(async () => {
    try {
      const [systemsRes, alarmsRes, settingsRes] = await Promise.all([
        fetch('/api/systems'),
        fetch('/api/alarms?acknowledged=false&resolved=false&limit=100'),
        fetch('/api/settings'),
      ])
      if (systemsRes.ok) {
        const freshSystems = await systemsRes.json()
        setSystems(freshSystems)
      }
      if (alarmsRes.ok) {
        const freshAlarms = await alarmsRes.json()
        setAlarms(freshAlarms)
      }
      if (settingsRes.ok) {
        const settings = await settingsRes.json()
        const enabled = settings.audioEnabled !== 'false'
        if (enabled) {
          setAudioMuted(false)
          setMuteEndTime(null)
        } else {
          const end = settings.muteEndTime ? parseInt(settings.muteEndTime) : 0
          if (end && end <= Date.now()) {
            // Mute expired, re-enable
            setAudioMuted(false)
            setMuteEndTime(null)
          } else {
            setAudioMuted(true)
            setMuteEndTime(end || null)
          }
        }
        setFeatureFlags(parseFeatureFlags(settings))
      }
      setLastUpdate(new Date())
    } catch (e) {
      console.error('[realtime] State sync failed:', e)
    }
  }, [])

  const hasConnectedOnce = useRef(false)

  const { connected, reconnecting } = useWebSocket({
    onMessage: handleMessage,
    onConnect: () => {
      console.log('[realtime] WebSocket connected')
      if (hasConnectedOnce.current) {
        // 재연결 시 전체 상태 동기화
        syncState()
      }
      hasConnectedOnce.current = true
    },
    onDisconnect: () => console.log('[realtime] WebSocket disconnected'),
  })

  // 주기적 상태 동기화 (30초) - WebSocket 메시지 유실 시 자동 복구
  useEffect(() => {
    if (!connected) return
    const interval = setInterval(syncState, 30000)
    return () => clearInterval(interval)
  }, [connected, syncState])

  // Update initial data when props change (e.g., page navigation)
  useEffect(() => {
    setSystems(initialSystems)
  }, [initialSystems])

  useEffect(() => {
    setAlarms(initialAlarms)
  }, [initialAlarms])

  const contextValue = useMemo<RealtimeContextValue>(
    () => ({
      systems,
      metrics,
      alarms,
      connected,
      reconnecting,
      lastUpdate,
      audioMuted,
      muteEndTime,
      featureFlags,
      setAudioMute,
      updateSystem,
      updateMetric,
      addAlarm,
    }),
    [systems, metrics, alarms, connected, reconnecting, lastUpdate, audioMuted, muteEndTime, featureFlags, setAudioMute, updateSystem, updateMetric, addAlarm]
  )

  return (
    <RealtimeContext.Provider value={contextValue}>
      {children}
    </RealtimeContext.Provider>
  )
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext)
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider')
  }
  return context
}
