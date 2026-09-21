'use client'

import {
  DeviceAdvanced,
  DeviceConnectionFields,
  DeviceDataPreview,
  DeviceEditor,
  DeviceNewHeader,
  DeviceSection,
} from '@/components/forms/device-editor'
import * as React from 'react'

import { useRawPreview } from '@/hooks/use-raw-preview'
import { useWindowHref } from '@/hooks/use-window-href'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

import { buildIngestPayloadFields } from '@/components/forms/ingest-options-inline'
import {
  SoundClientSection,
  buildClientSelection,
  provisionSoundClient,
  type RegistrationMode,
} from '@/components/forms/sound-client-section'
import { SystemAudioConfig } from '@/components/forms/system-audio-config'
import { SystemEquipmentConfig } from '@/components/forms/system-equipment-config'
import { SystemMetricsConfig } from '@/components/forms/system-metrics-config'
import type {
  AudioConfig,
  DataMatchCondition,
  DiscoveredClient,
  EquipmentConfig,
  MetricsConfig,
  SystemType,
} from '@/types'
import { Activity, Loader2, Thermometer } from 'lucide-react'

const TYPE_LABELS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  equipment: { label: "장비상태", icon: Activity },
  sensor: { label: "온습도", icon: Thermometer },
}

const DEFAULT_EQUIPMENT_CONFIG: EquipmentConfig = {
  normalPatterns: ["OK", "NORMAL", "정상"],
  criticalPatterns: ["CRITICAL", "FAIL", "심각"],
  matchMode: "exact",
}

const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  delimiter: ",",
  displayItems: [],
}

function getSystemType(type: string | null): SystemType {
  if (type && ['equipment', 'sensor'].includes(type)) {
    return type as SystemType
  }
  return 'equipment'
}

export default function SystemNewPage() {
  return (
    <Suspense fallback={
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <SystemNewForm />
    </Suspense>
  )
}

function SystemNewForm() {
  const router = useRouter()
  const windowHref = useWindowHref()
  const searchParams = useSearchParams()
  const typeParam = searchParams.get('type')

  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Form state
  const [name, setName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState<"udp" | "tcp" | "mqtt">("udp")
  const [topic, setTopic] = React.useState("")
  const [encoding, setEncoding] = React.useState<"buffer" | "utf8">("buffer")
  const [offlineThresholdMin, setOfflineThresholdMin] = React.useState("")
  const [systemType, setSystemType] = React.useState<SystemType>(() => getSystemType(typeParam))
  const [registrationMode, setRegistrationMode] = React.useState<RegistrationMode>("manual")

  // Config state
  const [equipmentConfig, setEquipmentConfig] = React.useState<EquipmentConfig>(
    DEFAULT_EQUIPMENT_CONFIG
  )
  const [metricsConfig, setMetricsConfig] = React.useState<MetricsConfig>(
    DEFAULT_METRICS_CONFIG
  )

  // Audio config state
  const [audioConfig, setAudioConfig] = React.useState<AudioConfig>({ type: 'none' })

  // Data preview state
  const { messages: previewMessages, connected: wsConnected } = useRawPreview(port, 10)

  // Update systemType when URL param changes
  React.useEffect(() => {
    setSystemType(getSystemType(typeParam))
  }, [typeParam])



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      if (!name.trim()) {
        throw new Error("시설명을 입력하세요")
      }
      if (protocol === "mqtt") {
        if (!topic.trim()) {
          throw new Error("MQTT 토픽을 입력하세요")
        }
      } else {
        if (!port.trim()) {
          throw new Error("포트 번호를 입력하세요")
        }
      }

      const portNum = protocol === "mqtt" ? null : parseInt(port, 10)
      if (protocol !== "mqtt") {
        if (isNaN(portNum as number) || (portNum as number) < 1 || (portNum as number) > 65535) {
          throw new Error("유효한 포트 번호를 입력하세요 (1-65535)")
        }
      }

      const config = systemType === "equipment" ? equipmentConfig : metricsConfig

      const payload = {
        name: name.trim(),
        type: systemType,
        port: portNum,
        protocol,
        ...buildIngestPayloadFields(encoding, offlineThresholdMin, topic),
        config,
        audioConfig: systemType === 'sensor' ? { type: 'none' as const } : audioConfig,
      }

      const response = await fetch("/api/systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "추가에 실패했습니다")
      }

      const newSystem = await response.json()

      // Auto-registered PC: hand it this server's address so it needs no manual setup.
      const linkedClient = systemType === "equipment" ? equipmentConfig.client : undefined
      if (linkedClient && portNum !== null) {
        const provisioned = await provisionSoundClient({
          client: linkedClient,
          port: portNum,
          config: equipmentConfig,
          facilityName: name.trim(),
        })
        if (provisioned) {
          await fetch(`/api/systems/${newSystem.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: { ...equipmentConfig, client: provisioned } }),
          }).catch(() => undefined)
        }
      }

      router.push(windowHref(`/systems/${newSystem.id}`))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  const typeInfo = TYPE_LABELS[systemType]
  const isSensor = systemType === "sensor"

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

  const getConditionsForItem = (itemName: string): DataMatchCondition[] | undefined =>
    metricsConfig.displayItems.find((i) => i.name === itemName)?.dataMatchConditions

  return (
    <form onSubmit={handleSubmit} className="device-editor-form">
      <DeviceEditor
        creating
        error={error}
        header={
          <DeviceNewHeader
            typeName={typeInfo.label}
            saving={saving}
            onBack={() => router.back()}
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
              onNameChange={setName}
              onPortChange={setPort}
              onProtocolChange={setProtocol}
              onTopicChange={setTopic}
              onEncodingChange={setEncoding}
              onOfflineThresholdChange={setOfflineThresholdMin}
              systemType={systemType as 'equipment' | 'sensor'}
              onSystemTypeChange={setSystemType}
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
                    isEditMode
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
                    />
                  </div>
                </DeviceSection>
                <DeviceAdvanced title="음성 알림 설정">
                  <div className="device-audio">
                    <SystemAudioConfig
                      config={audioConfig}
                      onChange={setAudioConfig}
                    />
                  </div>
                </DeviceAdvanced>
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
              getConditionsForItem={getConditionsForItem}
            />
          </>
        }
      />
    </form>
  )
}
