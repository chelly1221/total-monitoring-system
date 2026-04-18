"use client"

import * as React from "react"
import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Loader2, Activity, Thermometer, ArrowLeft, Check, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SystemDataPreview } from "@/components/forms/system-data-preview"
import { SystemEquipmentConfig } from "@/components/forms/system-equipment-config"
import { SystemMetricsConfig } from "@/components/forms/system-metrics-config"
import { SystemAudioConfig } from "@/components/forms/system-audio-config"
import type {
  SystemType,
  EquipmentConfig,
  MetricsConfig,
  AudioConfig,
  DataMatchCondition,
} from "@/types"

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
  const searchParams = useSearchParams()
  const typeParam = searchParams.get('type')

  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Form state
  const [name, setName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState<"udp" | "tcp">("udp")
  const [systemType, setSystemType] = React.useState<SystemType>(() => getSystemType(typeParam))

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
  const [previewMessages, setPreviewMessages] = React.useState<string[]>([])
  const [wsConnected, setWsConnected] = React.useState(false)

  // Update systemType when URL param changes
  React.useEffect(() => {
    setSystemType(getSystemType(typeParam))
  }, [typeParam])

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
              return newMessages.slice(-10)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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

      const config = systemType === "equipment" ? equipmentConfig : metricsConfig

      const payload = {
        name: name.trim(),
        type: systemType,
        port: portNum,
        protocol,
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
      router.push(`/systems/${newSystem.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  const typeInfo = TYPE_LABELS[systemType]
  const Icon = typeInfo.icon
  const isSensor = systemType === "sensor"

  const getConditionsForItem = (itemName: string): DataMatchCondition[] | undefined =>
    metricsConfig.displayItems.find((i) => i.name === itemName)?.dataMatchConditions

  return (
    <div className="flex flex-col h-full">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 pb-1.5">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.back()}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <h1 className="text-lg font-bold">{name.trim() || "새 시설"}</h1>
            <span className="text-xs text-muted-foreground">
              {typeInfo.label}
              {port && <> | 포트:{port} ({protocol.toUpperCase()})</>}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => router.back()}
              disabled={saving}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              type="submit"
              size="icon"
              disabled={saving}
              className="h-8 w-8"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {isSensor ? (
          <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-hidden">
            {/* Band 1: 기본정보 */}
            <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-card p-4 shrink-0">
              <div className="flex items-center gap-2">
                <Label htmlFor="name" className="whitespace-nowrap">시설명</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 온습도 센서"
                  className="w-64"
                  required
                />
              </div>
              <Select
                value={systemType}
                onValueChange={(value) => setSystemType(value as SystemType)}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as SystemType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Label htmlFor="port" className="whitespace-nowrap">포트</Label>
                <Input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="1892"
                  className="w-24"
                  min={1}
                  max={65535}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap">프로토콜</Label>
                <Select
                  value={protocol}
                  onValueChange={(value) => setProtocol(value as "udp" | "tcp")}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive shrink-0">
                {error}
              </div>
            )}

            {/* Band 2: 2열 레이아웃 (온습도 설정 | 데이터 미리보기) */}
            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
              {/* 왼쪽 컬럼: 온습도 설정 */}
              <Card className="flex-1 flex flex-col overflow-hidden p-0">
                <CardHeader className="shrink-0 py-2">
                  <CardTitle className="text-sm">온습도 설정</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3 overflow-y-auto px-3 pb-3">
                  <div className="flex-1 min-h-0 border rounded-lg p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">온도</div>
                    <SystemMetricsConfig
                      config={metricsConfig}
                      onChange={setMetricsConfig}
                      typeLabel="온도"
                      systemType="sensor"
                      fixedSensorMode={true}
                      sensorItemName="온도"
                    />
                  </div>
                  <div className="flex-1 min-h-0 border rounded-lg p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">습도</div>
                    <SystemMetricsConfig
                      config={metricsConfig}
                      onChange={setMetricsConfig}
                      typeLabel="습도"
                      systemType="sensor"
                      fixedSensorMode={true}
                      sensorItemName="습도"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* 중앙 컬럼: 데이터 미리보기 */}
              <Card className="flex-1 flex flex-col overflow-hidden p-0">
                <CardHeader className="shrink-0 py-2">
                  <CardTitle className="text-sm">데이터 미리보기</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden px-3 pb-3">
                  <div className="flex-1 min-h-0 border rounded-lg p-3">
                    <SystemDataPreview
                      port={port}
                      connected={wsConnected}
                      messages={previewMessages}
                      className="h-[calc(100%-1.5rem)]"
                      label="온도"
                      dataMatchConditions={getConditionsForItem("온도")}
                    />
                  </div>
                  <div className="flex-1 min-h-0 border rounded-lg p-3">
                    <SystemDataPreview
                      port={port}
                      connected={wsConnected}
                      messages={previewMessages}
                      className="h-[calc(100%-1.5rem)]"
                      label="습도"
                      dataMatchConditions={getConditionsForItem("습도")}
                    />
                  </div>
                </CardContent>
              </Card>

            </div>
          </div>
        ) : (
          /* equipment 레이아웃 */
          <div className="flex-1 flex flex-col gap-1.5 min-h-0 overflow-hidden">
            {/* Band 1: 기본정보 */}
            <div className="flex flex-wrap items-center gap-3 rounded border bg-card px-2 py-1.5 shrink-0">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="name" className="whitespace-nowrap text-xs text-muted-foreground">시설명</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 장비명"
                  className="w-48 h-7 text-xs"
                  required
                />
              </div>
              <Select
                value={systemType}
                onValueChange={(value) => setSystemType(value as SystemType)}
              >
                <SelectTrigger className="w-24 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as SystemType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="port" className="whitespace-nowrap text-xs text-muted-foreground">포트</Label>
                <Input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="1892"
                  className="w-20 h-7 text-xs"
                  min={1}
                  max={65535}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="whitespace-nowrap text-xs text-muted-foreground">프로토콜</Label>
                <Select
                  value={protocol}
                  onValueChange={(value) => setProtocol(value as "udp" | "tcp")}
                >
                  <SelectTrigger className="w-20 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive shrink-0">
                {error}
              </div>
            )}

            {/* Band 2: 2열 레이아웃 (설정 | 데이터 미리보기) */}
            <div className="flex-1 flex gap-2 min-h-0 overflow-hidden">
              {/* 왼쪽: 타입별 설정 */}
              <div className="flex-[2] flex flex-col overflow-hidden border rounded p-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
                  상태 판단 패턴
                </div>
                <div className="flex-1 overflow-y-auto">
                  <SystemEquipmentConfig
                    config={equipmentConfig}
                    onChange={setEquipmentConfig}
                    layout="horizontal"
                  />
                </div>
              </div>

              {/* 중앙: 데이터 미리보기 */}
              <div className="flex-1 flex flex-col overflow-hidden border rounded p-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
                  데이터 미리보기
                </div>
                <div className="flex-1 flex flex-col overflow-hidden">
                  <SystemDataPreview
                    port={port}
                    connected={wsConnected}
                    messages={previewMessages}
                    className="flex-1 min-h-0"
                  />
                </div>
              </div>

            </div>

            {/* Band 3: 음성 알림 설정 (equipment만) - 인라인 */}
            <div className="shrink-0">
              <SystemAudioConfig config={audioConfig} onChange={setAudioConfig} compact />
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
