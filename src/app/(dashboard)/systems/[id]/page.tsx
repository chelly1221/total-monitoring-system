'use client'

import {
  DeviceAdvanced,
  DeviceAlarmLog,
  DeviceConnectionFields,
  DeviceDataPreview,
  DeviceEditor,
  DeviceSection,
} from '@/components/forms/device-editor'
import { PingEventLog } from '@/components/forms/ping-event-log'
import { SystemMetricsConfig } from '@/components/forms/system-metrics-config'
import * as React from 'react'

import {
  buildIngestPayloadFields,
  offlineThresholdToMinutes,
} from '@/components/forms/ingest-options-inline'
import {
  SoundClientSection,
  buildClientSelection,
  provisionSoundClient,
  type RegistrationMode,
} from '@/components/forms/sound-client-section'
import { SystemAudioConfig } from '@/components/forms/system-audio-config'
import { SystemDetailHeader } from '@/components/forms/system-detail-header'
import { SystemEquipmentConfig } from '@/components/forms/system-equipment-config'
import { Button } from '@/components/ui/button'
import { useRawPreview } from '@/hooks/use-raw-preview'
import { useWindowHref } from '@/hooks/use-window-href'
import { useWebSocket } from '@/hooks/useWebSocket'
import type {
  AudioConfig,
  DataMatchCondition,
  DiscoveredClient,
  EquipmentConfig,
  MetricsConfig,
  SystemStatus,
  WebSocketMessage,
} from '@/types'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'

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
  offlineThreshold: number | null
  topic: string | null
  encoding: string | null
  createdAt: string
  updatedAt: string
  metrics: MetricData[]
  alarms: AlarmData[]
}

export default function SystemDetailPage() {
  const router = useRouter()
  const windowHref = useWindowHref()
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
  const [protocol, setProtocol] = React.useState<"udp" | "tcp" | "mqtt">("udp")
  const [topic, setTopic] = React.useState("")
  const [encoding, setEncoding] = React.useState<"buffer" | "utf8">("buffer")
  const [offlineThresholdMin, setOfflineThresholdMin] = React.useState("")
  const [metricsConfig, setMetricsConfig] = React.useState<MetricsConfig>(DEFAULT_METRICS_CONFIG)
  const [equipmentConfig, setEquipmentConfig] = React.useState<EquipmentConfig>(DEFAULT_EQUIPMENT_CONFIG)
  const [audioConfig, setAudioConfig] = React.useState<AudioConfig>(DEFAULT_AUDIO_CONFIG)
  const [registrationMode, setRegistrationMode] = React.useState<RegistrationMode>("manual")

  // Data preview state
  const { messages: previewMessages, connected: wsConnected } = useRawPreview(port, 100)

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
          router.replace(windowHref(`/ups/${systemId}`))
          return
        }

        setSystem(data)

        // Initialize form state
        setName(data.name)
        setPort(data.port?.toString() || "")
        setProtocol((data.protocol as "udp" | "tcp" | "mqtt") || "udp")
        setTopic(data.topic ?? "")
        setEncoding(data.encoding === "utf8" ? "utf8" : "buffer")
        setOfflineThresholdMin(offlineThresholdToMinutes(data.offlineThreshold))

        // Parse config based on type
        if (data.config) {
          try {
            const parsed = JSON.parse(data.config)
            if (data.type === "equipment") {
              setEquipmentConfig(parsed as EquipmentConfig)
              setRegistrationMode((parsed as EquipmentConfig).client ? "auto" : "manual")
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
  }, [systemId, router, windowHref])



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

      let portNum: number | null = null
      if (protocol !== "mqtt") {
        if (!port.trim()) {
          throw new Error("포트 번호를 입력하세요")
        }

        portNum = parseInt(port, 10)
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          throw new Error("유효한 포트 번호를 입력하세요 (1-65535)")
        }
      } else {
        if (!topic.trim()) {
          throw new Error("MQTT 토픽을 입력하세요")
        }
      }

      const systemType = system?.type
      const configValue = systemType === "equipment" ? equipmentConfig : metricsConfig  // sensor uses metricsConfig

      const payload: Record<string, unknown> = {
        name: name.trim(),
        type: systemType,
        port: portNum,
        protocol,
        ...buildIngestPayloadFields(encoding, offlineThresholdMin, topic),
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

      let updatedData = await response.json()

      // Linked PC: push the (possibly changed) port/patterns to the client.
      if (systemType === "equipment" && equipmentConfig.client && portNum !== null) {
        const provisioned = await provisionSoundClient({
          client: equipmentConfig.client,
          port: portNum,
          config: equipmentConfig,
          facilityName: name.trim(),
        })
        if (provisioned) {
          const nextConfig = { ...equipmentConfig, client: provisioned }
          const patch = await fetch(`/api/systems/${systemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: nextConfig }),
          }).catch(() => null)
          if (patch?.ok) {
            updatedData = await patch.json()
            setEquipmentConfig(nextConfig)
          }
        }
      }

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
      setProtocol((system.protocol as "udp" | "tcp" | "mqtt") || "udp")
      setTopic(system.topic ?? "")
      setEncoding(system.encoding === "utf8" ? "utf8" : "buffer")
      setOfflineThresholdMin(offlineThresholdToMinutes(system.offlineThreshold))
      if (system.config) {
        try {
          const parsed = JSON.parse(system.config)
          if (system.type === "equipment") {
            setEquipmentConfig(parsed as EquipmentConfig)
            setRegistrationMode((parsed as EquipmentConfig).client ? "auto" : "manual")
          } else if (system.type === "sensor") {
            setMetricsConfig(parsed as MetricsConfig)
          }
        } catch {
          setMetricsConfig(DEFAULT_METRICS_CONFIG)
          setEquipmentConfig(DEFAULT_EQUIPMENT_CONFIG)
          setRegistrationMode("manual")
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

  const handleClientSelect = (client: DiscoveredClient, suggestedPort: number | null) => {
    const selection = buildClientSelection(client, suggestedPort, equipmentConfig)
    if (!name.trim()) setName(selection.name)
    setPort(selection.port)
    setProtocol(selection.protocol)
    setEncoding(selection.encoding)
    setEquipmentConfig(selection.config)
  }

  const handleClientUnlink = () => {
    setEquipmentConfig((prev) => {
      const next = { ...prev }
      delete next.client
      return next
    })
  }

  return (
    <DeviceEditor
      error={error}
      header={
        <SystemDetailHeader
          system={system}
          displayName={isEditMode ? name : system.name}
          displayPort={String(isEditMode ? port : (system.port ?? ''))}
          displayProtocol={(isEditMode ? protocol : system.protocol) ?? 'udp'}
          displayTopic={isEditMode ? topic : (system.topic ?? '')}
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
      }
      connection={
        <>
          <DeviceConnectionFields
            name={name}
            port={port}
            protocol={protocol}
            topic={topic}
            encoding={encoding}
            offlineThresholdMin={offlineThresholdMin}
            disabled={!isEditMode}
            onNameChange={setName}
            onPortChange={setPort}
            onProtocolChange={setProtocol}
            onTopicChange={setTopic}
            onEncodingChange={setEncoding}
            onOfflineThresholdChange={setOfflineThresholdMin}
          />
          {!isSensor && (
            <DeviceSection
              title="클라이언트 연결"
              description="자동 탐지하거나 통신 정보를 직접 입력합니다."
            >
              <div className="device-linked-client">
                <SoundClientSection
                  mode={registrationMode}
                  onModeChange={setRegistrationMode}
                  client={equipmentConfig.client}
                  currentSystemId={systemId}
                  isEditMode={isEditMode}
                  onSelect={handleClientSelect}
                  onUnlink={handleClientUnlink}
                  allowedKinds={['sound', 'ping']}
                />
              </div>
            </DeviceSection>
          )}
        </>
      }
      settings={
        <>
          {isSensor ? (
            <DeviceSection
              title="온도 · 습도 알람 기준"
              description="정상 범위를 벗어나는 조건을 각각 설정합니다."
            >
              <SystemMetricsConfig
                config={metricsConfig}
                onChange={setMetricsConfig}
                typeLabel="온습도"
                systemType="sensor"
                layout="editor"
                fixedSensorMode
                disabled={!isEditMode}
              />
            </DeviceSection>
          ) : (
            <>
              <DeviceSection
                title="상태 판단 · 알람 기준"
                description="수신 메시지를 비교할 정상·심각 패턴을 지정합니다."
              >
                <div className="device-equipment">
                  <SystemEquipmentConfig
                    config={equipmentConfig}
                    onChange={setEquipmentConfig}
                    layout="horizontal"
                    disabled={!isEditMode}
                  />
                </div>
              </DeviceSection>
              {isEditMode && (
                <DeviceAdvanced title="음성 알림 설정">
                  <div className="device-audio">
                    <SystemAudioConfig
                      config={audioConfig}
                      onChange={setAudioConfig}
                    />
                  </div>
                </DeviceAdvanced>
              )}
            </>
          )}
        </>
      }
      preview={
        <>
          <DeviceDataPreview
            kind={isSensor ? 'sensor' : 'equipment'}
            port={port}
            connected={wsConnected}
            messages={previewMessages}
            metrics={system.metrics}
            getConditionsForItem={getConditionsForItem}
          />
          <DeviceAlarmLog
            alarms={system.alarms}
            onAcknowledge={handleAcknowledge}
          />
          {equipmentConfig.client?.kind === 'ping' && (
            <DeviceSection title="Ping 장애 · 복구 내역">
              <PingEventLog systemId={systemId} />
            </DeviceSection>
          )}
        </>
      }
    />
  )
}
