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
import { useRouter } from 'next/navigation'

import { buildIngestPayloadFields } from '@/components/forms/ingest-options-inline'
import {
  SoundClientSection,
  buildUpsClientSelection,
  provisionUpsClient,
  type RegistrationMode,
} from '@/components/forms/sound-client-section'
import { SystemCustomCode } from '@/components/forms/system-custom-code'
import { SystemMetricsConfig } from '@/components/forms/system-metrics-config'
import { UpsAudioConfig } from '@/components/forms/ups-audio-config'
import { upsClientUnit } from '@/lib/ups-client-preset'
import type { AudioConfig, DiscoveredClient, MetricsConfig } from '@/types'

const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  delimiter: ",",
  displayItems: [],
}

export default function UpsNewPage() {
  const router = useRouter()
  const windowHref = useWindowHref()

  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Form state
  const [name, setName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState<"udp" | "tcp" | "mqtt">("udp")
  const [topic, setTopic] = React.useState("")
  const [encoding, setEncoding] = React.useState<"buffer" | "utf8">("buffer")
  const [offlineThresholdMin, setOfflineThresholdMin] = React.useState("")

  // Config state
  const [metricsConfig, setMetricsConfig] = React.useState<MetricsConfig>(
    DEFAULT_METRICS_CONFIG
  )

  // Audio config state
  const [audioConfig, setAudioConfig] = React.useState<AudioConfig>({ type: 'none' })

  // 등록 방식: 수동 입력 / 자동 탐지 (2026 1레이더 UPS 클라이언트)
  const [registrationMode, setRegistrationMode] = React.useState<RegistrationMode>("manual")

  // Custom code test result state
  const [customCodeTestResult, setCustomCodeTestResult] = React.useState<Record<string, number | string> | null>(null)

  // Data preview state
  const { messages: previewMessages, connected: wsConnected } = useRawPreview(port, 10)



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      if (!name.trim()) {
        throw new Error("시설명을 입력하세요")
      }

      let portNum: number | null = null
      if (protocol === "mqtt") {
        if (!topic.trim()) {
          throw new Error("MQTT 토픽을 입력하세요")
        }
      } else {
        if (!port.trim()) {
          throw new Error("포트 번호를 입력하세요")
        }

        portNum = parseInt(port, 10)
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          throw new Error("유효한 포트 번호를 입력하세요 (1-65535)")
        }
      }

      const payload = {
        name: name.trim(),
        type: "ups" as const,
        port: portNum,
        protocol,
        ...buildIngestPayloadFields(encoding, offlineThresholdMin, topic),
        config: metricsConfig,
        audioConfig,
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

      // Auto-registered UPS PC: hand it this server's address and the UPS number.
      const linkedClient = metricsConfig.client
      if (linkedClient?.kind === "ups" && portNum !== null) {
        const provisioned = await provisionUpsClient({ client: linkedClient, port: portNum, facilityName: name.trim() })
        if (provisioned) {
          await fetch(`/api/systems/${newSystem.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: { ...metricsConfig, client: provisioned } }),
          }).catch(() => undefined)
        }
      }

      router.push(windowHref(`/ups/${newSystem.id}`))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  const handleClientSelect = (client: DiscoveredClient, suggestedPort: number | null, unit: 1 | 2 = upsClientUnit(metricsConfig.client?.unit)) => {
    const selection = buildUpsClientSelection(client, unit, suggestedPort, metricsConfig)
    if (!name.trim() || metricsConfig.client) setName(selection.name)
    setPort(selection.port)
    setProtocol(selection.protocol)
    setEncoding(selection.encoding)
    setMetricsConfig(selection.config)
  }

  const handleClientUnlink = () => {
    setMetricsConfig((prev) => {
      const next = { ...prev }
      delete next.client
      return next
    })
  }

  return (
    <form onSubmit={handleSubmit} className="device-editor-form">
      <DeviceEditor
        creating
        error={error}
        header={
          <DeviceNewHeader
            typeName={'UPS'}
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
            />
            <DeviceSection
              title="UPS 클라이언트 연결"
              description="자동 탐지하거나 통신 정보를 직접 입력합니다."
            >
              <div className="device-linked-client">
                <SoundClientSection
                  mode={registrationMode}
                  onModeChange={setRegistrationMode}
                  client={metricsConfig.client}
                  isEditMode
                  onSelect={handleClientSelect}
                  onUnlink={handleClientUnlink}
                  allowedKinds={['ups']}
                  upsUnit={upsClientUnit(metricsConfig.client?.unit)}
                  onUpsUnitChange={(unit) => {
                    const client = metricsConfig.client
                    if (!client) return
                    const discovered: DiscoveredClient = {
                      ...client,
                      kind: 'ups',
                      serverIp: client.serverIp ?? '',
                      mac: client.mac ?? '',
                      ver: client.ver ?? '',
                      target: null,
                      muted: false,
                      sound: false,
                      uptimeSec: 0,
                      registered: null,
                    }
                    handleClientSelect(
                      discovered,
                      port ? Number(port) : null,
                      unit
                    )
                  }}
                />
              </div>
            </DeviceSection>
          </>
        }
        settings={
          <>
            <DeviceSection
              title="감시 항목 · 알람 기준"
              description="표시할 항목과 알람 조건을 관리합니다. 항목 이름을 누르면 세부 설정을 열 수 있습니다."
            >
              <SystemMetricsConfig
                config={metricsConfig}
                onChange={setMetricsConfig}
                typeLabel="UPS"
                systemType="ups"
                layout="editor"
                testResultKeys={
                  customCodeTestResult
                    ? Object.keys(customCodeTestResult)
                    : null
                }
              />
            </DeviceSection>
            <DeviceAdvanced title="고급 설정 · 사용자 정의 파서">
              <SystemCustomCode
                code={metricsConfig.customCode}
                onChange={(code) =>
                  setMetricsConfig((prev) => ({
                    ...prev,
                    customCode: code || undefined,
                  }))
                }
                latestRawData={previewMessages[previewMessages.length - 1]}
                onTestResult={setCustomCodeTestResult}
                displayItems={metricsConfig.displayItems}
                onAutoPopulate={(items) =>
                  setMetricsConfig((prev) => ({ ...prev, displayItems: items }))
                }
              />
            </DeviceAdvanced>
            <DeviceAdvanced title="음성 알림 설정">
              <div className="device-audio">
                <UpsAudioConfig
                  config={audioConfig}
                  onChange={setAudioConfig}
                />
              </div>
            </DeviceAdvanced>
          </>
        }
        preview={
          <>
            <DeviceDataPreview
              kind={'ups'}
              port={port}
              connected={wsConnected}
              messages={previewMessages}
            />
          </>
        }
      />
    </form>
  )
}
