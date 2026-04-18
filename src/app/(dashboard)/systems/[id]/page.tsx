"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SystemEquipmentConfig } from "@/components/forms/system-equipment-config"
import { SystemAudioConfig } from "@/components/forms/system-audio-config"
import { SystemDetailHeader } from "@/components/forms/system-detail-header"
import { SystemBasicInfoBar } from "@/components/forms/system-basic-info-bar"
import { SystemPreviewAlarmSidebar } from "@/components/forms/system-preview-alarm-sidebar"
import { SensorBasicInfoBar } from "@/components/forms/sensor-basic-info-bar"
import { SensorAlarmLog } from "@/components/forms/sensor-alarm-log"
import { SensorSettingsCard } from "@/components/forms/sensor-settings-card"
import { SensorDataPreviewCard } from "@/components/forms/sensor-data-preview-card"
import { useWebSocket } from "@/hooks/useWebSocket"
import type {
  SystemStatus,
  WebSocketMessage,
  SystemType,
  MetricsConfig,
  EquipmentConfig,
  AudioConfig,
  DataMatchCondition,
} from "@/types"

const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  delimiter: ",",
  displayItems: [],
}

const DEFAULT_EQUIPMENT_CONFIG: EquipmentConfig = {
  normalPatterns: ["OK", "NORMAL", "정상"],
  criticalPatterns: ["CRITICAL", "FAIL", "심각"],
  matchMode: "exact",
}

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  type: "none",
}

function getSystemType(type: string): SystemType {
  if (["equipment", "sensor"].includes(type)) {
    return type as SystemType
  }
  return "equipment"
}

interface MetricData {
  id: string
  name: string
  value: number
  unit: string
  min: number | null
  max: number | null
  warningThreshold: number | null
  criticalThreshold: number | null
  trend: string | null
}

interface AlarmData {
  id: string
  severity: string
  message: string
  value?: string | null
  createdAt: string
  acknowledged: boolean
  acknowledgedAt: string | null
  system: { id: string; name: string }
}

interface SystemWithRelations {
  id: string
  name: string
  type: string
  status: string
  port: number | null
  protocol: string | null
  isEnabled: boolean
  isActive: boolean
  config: string | null
  audioConfig: string | null
  lastDataAt: string | null
  createdAt: string
  updatedAt: string
  metrics: MetricData[]
  alarms: AlarmData[]
}

export default function SystemDetailPage() {
  const router = useRouter()
  const params = useParams()
  const systemId = params.id as string

  const [system, setSystem] = React.useState<SystemWithRelations | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Edit mode state
  const [isEditMode, setIsEditMode] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Form state for edit mode
  const [name, setName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState<"udp" | "tcp">("udp")
  const [metricsConfig, setMetricsConfig] = React.useState<MetricsConfig>(DEFAULT_METRICS_CONFIG)
  const [equipmentConfig, setEquipmentConfig] = React.useState<EquipmentConfig>(DEFAULT_EQUIPMENT_CONFIG)
  const [audioConfig, setAudioConfig] = React.useState<AudioConfig>(DEFAULT_AUDIO_CONFIG)

  // Data preview state
  const [previewMessages, setPreviewMessages] = React.useState<string[]>([])
  const [wsConnected, setWsConnected] = React.useState(false)

  const handleWebSocketMessage = React.useCallback(
    (message: WebSocketMessage) => {
      setSystem((prev) => {
        if (!prev) return prev

        // Handle bulk alarm acknowledgment
        if (
          message.type === "alarm" &&
          message.data.acknowledged &&
          message.data.bulk &&
          message.data.alarmIds
        ) {
          const acknowledgedIds = new Set(message.data.alarmIds as string[])
          return {
            ...prev,
            alarms: prev.alarms.map((a) =>
              acknowledgedIds.has(a.id)
                ? { ...a, acknowledged: true, acknowledgedAt: message.timestamp }
                : a
            ),
          }
        }

        // Handle single alarm acknowledgment (from any source)
        if (message.type === "alarm" && message.data.acknowledged && message.data.alarmId) {
          return {
            ...prev,
            alarms: prev.alarms.map((a) =>
              a.id === message.data.alarmId
                ? { ...a, acknowledged: true, acknowledgedAt: message.timestamp }
                : a
            ),
          }
        }

        // Below handlers require matching systemId
        if (!message.data?.systemId || message.data.systemId !== systemId) return prev

        if (message.type === "system") {
          return {
            ...prev,
            status: message.data.status || prev.status,
          }
        }

        if (message.type === "metric" && message.data.metricId) {
          return {
            ...prev,
            metrics: prev.metrics.map((m) =>
              m.id === message.data.metricId
                ? {
                    ...m,
                    value: message.data.value ?? m.value,
                    trend: message.data.trend ?? m.trend,
                  }
                : m
            ),
          }
        }

        if (message.type === "alarm" && message.data.alarmId && !message.data.acknowledged) {
          const newAlarm: AlarmData = {
            id: message.data.alarmId,
            severity: message.data.severity || "warning",
            message: message.data.message || "",
            value: message.data.alarmValue ?? null,
            createdAt: message.timestamp,
            acknowledged: false,
            acknowledgedAt: null,
            system: { id: systemId, name: prev.name },
          }
          return {
            ...prev,
            alarms: [newAlarm, ...prev.alarms].slice(0, 10),
          }
        }

        return prev
      })
    },
    [systemId]
  )

  useWebSocket({
    onMessage: handleWebSocketMessage,
  })

  // Fetch system data
  React.useEffect(() => {
    async function fetchSystem() {
      try {
        const response = await fetch(`/api/systems/${systemId}`)
        if (!response.ok) {
          throw new Error("시설을 찾을 수 없습니다")
        }
        const data = await response.json()

        // If UPS type, redirect to UPS page
        if (data.type === "ups") {
          router.replace(`/ups/${systemId}`)
          return
        }

        setSystem(data)

        // Initialize form state
        setName(data.name)
        setPort(data.port?.toString() || "")
        setProtocol((data.protocol as "udp" | "tcp") || "udp")

        // Parse config based on type
        if (data.config) {
          try {
            const parsed = JSON.parse(data.config)
            if (data.type === "equipment") {
              setEquipmentConfig(parsed as EquipmentConfig)
            } else if (data.type === "sensor") {
              setMetricsConfig(parsed as MetricsConfig)
            }
          } catch {
            // Use defaults
          }
        }

        // Parse audioConfig
        if (data.audioConfig) {
          try {
            setAudioConfig(JSON.parse(data.audioConfig) as AudioConfig)
          } catch {
            // Use defaults
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다")
      } finally {
        setLoading(false)
      }
    }

    fetchSystem()
  }, [systemId, router])

  // WebSocket connection for data preview
  React.useEffect(() => {
    const portNum = parseInt(port, 10)
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setPreviewMessages([])
      setWsConnected(false)
      return
    }

    const wsUrl = `ws://${window.location.hostname}:7778`
    let ws: WebSocket | null = null

    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setWsConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === "raw" && message.data?.port === portNum) {
            setPreviewMessages((prev) => {
              const newMessages = [...prev, message.data.rawData]
              return newMessages.slice(-100)
            })
          }
        } catch {
          // Ignore parse errors
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
      }

      ws.onerror = () => {
        setWsConnected(false)
      }
    } catch {
      setWsConnected(false)
    }

    return () => {
      if (ws) {
        ws.close()
      }
    }
  }, [port])

  const handleAcknowledge = async (alarmId: string) => {
    try {
      const response = await fetch(`/api/alarms/${alarmId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgedBy: "operator" }),
      })
      if (response.ok) {
        setSystem((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            alarms: prev.alarms.map((alarm) =>
              alarm.id === alarmId
                ? { ...alarm, acknowledged: true, acknowledgedAt: new Date().toISOString() }
                : alarm
            ),
          }
        })
      }
    } catch (error) {
      console.error("Failed to acknowledge alarm:", error)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      if (!name.trim()) {
        throw new Error("시설명을 입력하세요")
      }
      if (!port.trim()) {
        throw new Error("포트 번호를 입력하세요")
      }

      const portNum = parseInt(port, 10)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error("유효한 포트 번호를 입력하세요 (1-65535)")
      }

      const systemType = system?.type
      const configValue = systemType === "equipment" ? equipmentConfig : metricsConfig  // sensor uses metricsConfig

      const payload: Record<string, unknown> = {
        name: name.trim(),
        type: systemType,
        port: portNum,
        protocol,
        config: configValue,
      }

      // Include audioConfig for non-sensor types
      if (systemType !== "sensor") {
        payload.audioConfig = audioConfig
      } else {
        payload.audioConfig = { type: "none" as const }
      }

      const response = await fetch(`/api/systems/${systemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "저장에 실패했습니다")
      }

      // Refetch system data
      const updatedData = await response.json()
      setSystem(updatedData)
      setIsEditMode(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    // Reset form to original values
    if (system) {
      setName(system.name)
      setPort(system.port?.toString() || "")
      setProtocol((system.protocol as "udp" | "tcp") || "udp")
      if (system.config) {
        try {
          const parsed = JSON.parse(system.config)
          if (system.type === "equipment") {
            setEquipmentConfig(parsed as EquipmentConfig)
          } else if (system.type === "sensor") {
            setMetricsConfig(parsed as MetricsConfig)
          }
        } catch {
          setMetricsConfig(DEFAULT_METRICS_CONFIG)
          setEquipmentConfig(DEFAULT_EQUIPMENT_CONFIG)
        }
      }
      if (system.audioConfig) {
        try {
          setAudioConfig(JSON.parse(system.audioConfig) as AudioConfig)
        } catch {
          setAudioConfig(DEFAULT_AUDIO_CONFIG)
        }
      } else {
        setAudioConfig(DEFAULT_AUDIO_CONFIG)
      }
    }
    setError(null)
    setIsEditMode(false)
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !system) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{error || "시설을 찾을 수 없습니다"}</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          뒤로
        </Button>
      </div>
    )
  }

  if (!system) return null

  const status = system.status as SystemStatus
  const isEnabled = system.isEnabled !== false
  const isSensor = system.type === "sensor"

  const getConditionsForItem = (name: string): DataMatchCondition[] | undefined =>
    metricsConfig.displayItems.find((i) => i.name === name)?.dataMatchConditions

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <SystemDetailHeader
        system={system}
        displayName={isEditMode ? name : system.name}
        displayPort={String(isEditMode ? port : system.port ?? "")}
        displayProtocol={(isEditMode ? protocol : system.protocol) ?? "udp"}
        status={status}
        isEnabled={isEnabled}
        isEditMode={isEditMode}
        saving={saving}
        onBack={() => router.back()}
        onSave={handleSave}
        onCancel={handleCancel}
        onEditClick={() => setIsEditMode(true)}
        onEnabledChange={(enabled) =>
          setSystem((prev) => (prev ? { ...prev, isEnabled: enabled } : prev))
        }
      />

      {/* Content - sensor 타입은 3열 레이아웃 */}
      {isSensor ? (
        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden">
          {/* Band 1: 기본정보 (편집 모드에서만 수정 가능) */}
          <SensorBasicInfoBar
            name={name}
            port={port}
            protocol={protocol}
            isEditMode={isEditMode}
            onNameChange={setName}
            onPortChange={setPort}
            onProtocolChange={(v) => setProtocol(v)}
          />

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive shrink-0">
              {error}
            </div>
          )}

          {/* Band 2: 3열 레이아웃 (온습도 설정 | 데이터 미리보기 | 알람) */}
          <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
            <SensorSettingsCard
              config={metricsConfig}
              onChange={setMetricsConfig}
              systemType={getSystemType(system.type)}
              disabled={!isEditMode}
            />
            <SensorDataPreviewCard
              port={port}
              connected={wsConnected}
              messages={previewMessages}
              getConditionsForItem={getConditionsForItem}
            />
            <SensorAlarmLog
              alarms={system.alarms}
              onAcknowledge={handleAcknowledge}
            />
          </div>
        </div>
      ) : (
        /* equipment: 인라인 편집 레이아웃 */
        <div className="flex-1 flex flex-col gap-1.5 min-h-0 overflow-hidden">
          {/* Band 1: 기본정보 */}
          <SystemBasicInfoBar
            name={name}
            port={port}
            protocol={protocol}
            isEditMode={isEditMode}
            onNameChange={setName}
            onPortChange={setPort}
            onProtocolChange={(v) => setProtocol(v)}
          />

          {error && (
            <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive shrink-0">
              {error}
            </div>
          )}

          {/* Band 2: 2열 레이아웃 (설정 | 미리보기+알람) */}
          <div className="flex-1 flex gap-2 min-h-0 overflow-hidden">
            {/* 왼쪽: 타입별 설정 */}
            <div className="flex-[3] flex flex-col overflow-hidden border rounded p-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
                상태 판단 패턴
              </div>
              <div className="flex-1 overflow-y-auto">
                <SystemEquipmentConfig
                  config={equipmentConfig}
                  onChange={setEquipmentConfig}
                  layout="horizontal"
                  disabled={!isEditMode}
                />
              </div>
            </div>

            {/* 오른쪽: 데이터 미리보기 + 알람 로그 */}
            <SystemPreviewAlarmSidebar
              port={port}
              wsConnected={wsConnected}
              previewMessages={previewMessages}
              alarms={system.alarms}
              onAcknowledge={handleAcknowledge}
            />
          </div>

          {/* Band 3: 음성 알림 설정 (편집 모드에서만) - 인라인 */}
          {isEditMode && (
            <div className="shrink-0">
              <SystemAudioConfig config={audioConfig} onChange={setAudioConfig} compact />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
