"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Loader2, ArrowLeft, Check, X } from "lucide-react"
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
import { UpsDataPreview } from "@/components/forms/ups-data-preview"
import { SystemMetricsConfig } from "@/components/forms/system-metrics-config"
import { UpsAudioConfig } from "@/components/forms/ups-audio-config"
import { SystemCustomCode } from "@/components/forms/system-custom-code"
import type {
  MetricsConfig,
  AudioConfig,
} from "@/types"

const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  delimiter: ",",
  displayItems: [],
}

export default function UpsNewPage() {
  const router = useRouter()

  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Form state
  const [name, setName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState<"udp" | "tcp">("udp")

  // Config state
  const [metricsConfig, setMetricsConfig] = React.useState<MetricsConfig>(
    DEFAULT_METRICS_CONFIG
  )

  // Audio config state
  const [audioConfig, setAudioConfig] = React.useState<AudioConfig>({ type: 'none' })

  // Custom code test result state
  const [customCodeTestResult, setCustomCodeTestResult] = React.useState<Record<string, number | string> | null>(null)

  // Data preview state
  const [previewMessages, setPreviewMessages] = React.useState<string[]>([])
  const [wsConnected, setWsConnected] = React.useState(false)

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

      const payload = {
        name: name.trim(),
        type: "ups" as const,
        port: portNum,
        protocol,
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
      router.push(`/ups/${newSystem.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 pb-1.5">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.back()}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <h1 className="text-lg font-bold">{name.trim() || "새 UPS"}</h1>
            <span className="text-xs text-muted-foreground">
              UPS
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

        {/* UPS 레이아웃 */}
        <div className="flex-1 flex flex-col gap-1.5 min-h-0 overflow-hidden">
          {/* Band 1: 기본정보 */}
          <div className="flex flex-wrap items-center gap-3 rounded border bg-card px-2 py-1.5 shrink-0">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="name" className="whitespace-nowrap text-xs text-muted-foreground">시설명</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 관제송신 UPS"
                className="w-48 h-7 text-xs"
                required
              />
            </div>
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

          {/* Band 2: 2열 레이아웃 (메트릭 설정 | 데이터 미리보기) */}
          <div className="flex-1 flex gap-2 min-h-0 overflow-hidden">
            {/* 왼쪽: 메트릭 설정 */}
            <div className="flex-[2] flex flex-col overflow-hidden border rounded p-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
                메트릭 설정
              </div>
              <div className="flex-1 overflow-y-auto">
                <SystemMetricsConfig
                  config={metricsConfig}
                  onChange={setMetricsConfig}
                  typeLabel="UPS"
                  systemType="ups"
                  testResultKeys={customCodeTestResult ? Object.keys(customCodeTestResult) : null}
                />
                <SystemCustomCode
                  code={metricsConfig.customCode}
                  onChange={(code) => setMetricsConfig(prev => ({ ...prev, customCode: code || undefined }))}
                  latestRawData={previewMessages[previewMessages.length - 1]}
                  onTestResult={setCustomCodeTestResult}
                  displayItems={metricsConfig.displayItems}
                  onAutoPopulate={(items) => setMetricsConfig(prev => ({ ...prev, displayItems: items }))}
                />
              </div>
            </div>

            {/* 중앙: 데이터 미리보기 */}
            <div className="flex-1 flex flex-col overflow-hidden border rounded p-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
                데이터 미리보기
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                <UpsDataPreview
                  port={port}
                  connected={wsConnected}
                  messages={previewMessages}
                  className="flex-1 min-h-0"
                />
              </div>
            </div>

          </div>

          {/* Band 3: 음성 알림 설정 - 인라인 */}
          <div className="shrink-0">
            <UpsAudioConfig config={audioConfig} onChange={setAudioConfig} compact />
          </div>
        </div>
      </form>
    </div>
  )
}
