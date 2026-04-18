"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SystemMetricsConfig } from "@/components/forms/system-metrics-config"
import { UpsAudioConfig } from "@/components/forms/ups-audio-config"
import { SystemCustomCode } from "@/components/forms/system-custom-code"
import { UpsDetailHeader } from "@/components/forms/ups-detail-header"
import { UpsBasicInfoBar } from "@/components/forms/ups-basic-info-bar"
import { UpsPreviewAlarmSidebar } from "@/components/forms/ups-preview-alarm-sidebar"
import { useWebSocket } from "@/hooks/useWebSocket"
import type {
  SystemStatus,
  WebSocketMessage,
  MetricsConfig,
  AudioConfig,
} from "@/types"

const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  delimiter: ",",
  displayItems: [],
}

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  type: "none",
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

export default function UpsDetailPage() {
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
  const [audioConfig, setAudioConfig] = React.useState<AudioConfig>(DEFAULT_AUDIO_CONFIG)

  // Custom code test result state
  const [customCodeTestResult, setCustomCodeTestResult] = React.useState<Record<string, number | string> | null>(null)

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

        // If not a UPS, redirect to systems page
        if (data.type !== "ups") {
          router.replace(`/systems/${systemId}`)
          return
        }

        setSystem(data)

        // Initialize form state
        setName(data.name)
        setPort(data.port?.toString() || "")
        setProtocol((data.protocol as "udp" | "tcp") || "udp")

        // Parse config
        if (data.config) {
          try {
            const parsed = JSON.parse(data.config)
            setMetricsConfig(parsed as MetricsConfig)
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

      const payload: Record<string, unknown> = {
        name: name.trim(),
        type: "ups",
        port: portNum,
        protocol,
        config: metricsConfig,
        audioConfig,
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
          setMetricsConfig(parsed as MetricsConfig)
        } catch {
          setMetricsConfig(DEFAULT_METRICS_CONFIG)
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
    setCustomCodeTestResult(null)
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <UpsDetailHeader
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

      {/* UPS: 인라인 편집 레이아웃 */}
      <div className="flex-1 flex flex-col gap-1.5 min-h-0 overflow-hidden">
        {/* Band 1: 기본정보 */}
        <UpsBasicInfoBar
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
          {/* 왼쪽: 메트릭 설정 */}
          <div className="flex-[3] flex flex-col overflow-hidden border rounded p-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
              메트릭 설정
            </div>
            <div className="flex-1 overflow-y-auto">
              <SystemMetricsConfig
                config={metricsConfig}
                onChange={setMetricsConfig}
                typeLabel="UPS"
                systemType="ups"
                disabled={!isEditMode}
                testResultKeys={customCodeTestResult ? Object.keys(customCodeTestResult) : null}
              />
              <SystemCustomCode
                code={metricsConfig.customCode}
                onChange={(code) => setMetricsConfig(prev => ({ ...prev, customCode: code || undefined }))}
                latestRawData={previewMessages[previewMessages.length - 1]}
                disabled={!isEditMode}
                onTestResult={setCustomCodeTestResult}
                displayItems={metricsConfig.displayItems}
                onAutoPopulate={(items) => setMetricsConfig(prev => ({ ...prev, displayItems: items }))}
              />
            </div>
          </div>

          {/* 오른쪽: 데이터 미리보기 + 알람 로그 */}
          <UpsPreviewAlarmSidebar
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
            <UpsAudioConfig config={audioConfig} onChange={setAudioConfig} compact />
          </div>
        )}
      </div>
    </div>
  )
}
