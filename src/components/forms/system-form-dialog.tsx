"use client"

import * as React from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader2, Activity, Battery, Thermometer } from "lucide-react"
import { SystemPortConfig } from "./system-port-config"
import { SystemDataPreview } from "./system-data-preview"
import { SystemEquipmentConfig } from "./system-equipment-config"
import { SystemMetricsConfig } from "./system-metrics-config"
import type {
  PrismaSystem,
  SystemType,
  EquipmentConfig,
  MetricsConfig,
} from "@/types"

const TYPE_LABELS: Record<SystemType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  equipment: { label: "장비상태", icon: Activity },
  ups: { label: "UPS", icon: Battery },
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

interface SystemFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  system?: PrismaSystem | null
  systemType: SystemType
  onSuccess?: () => void
}

export function SystemFormDialog({
  open,
  onOpenChange,
  system,
  systemType,
  onSuccess,
}: SystemFormDialogProps) {
  const isEdit = !!system
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Form state
  const [name, setName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState<"udp" | "tcp">("udp")
  const [isEnabled, setIsEnabled] = React.useState(true)

  // Config state
  const [equipmentConfig, setEquipmentConfig] = React.useState<EquipmentConfig>(
    DEFAULT_EQUIPMENT_CONFIG
  )
  const [metricsConfig, setMetricsConfig] = React.useState<MetricsConfig>(
    DEFAULT_METRICS_CONFIG
  )

  // Data preview state
  const [previewMessages, setPreviewMessages] = React.useState<string[]>([])
  const [wsConnected, setWsConnected] = React.useState(false)

  // Initialize form when sheet opens
  React.useEffect(() => {
    if (open) {
      if (system) {
        setName(system.name)
        setPort(system.port?.toString() || "")
        setProtocol((system.protocol as "udp" | "tcp") || "udp")
        setIsEnabled(system.isEnabled !== false)

        // Parse config
        if (system.config) {
          try {
            const parsed = JSON.parse(system.config)
            if (system.type === "equipment") {
              setEquipmentConfig(parsed as EquipmentConfig)
            } else {
              setMetricsConfig(parsed as MetricsConfig)
            }
          } catch {
            // Use defaults
          }
        }
      } else {
        setName("")
        setPort("")
        setProtocol("udp")
        setIsEnabled(true)
        setEquipmentConfig(DEFAULT_EQUIPMENT_CONFIG)
        setMetricsConfig(DEFAULT_METRICS_CONFIG)
      }
      setError(null)
      setPreviewMessages([])
    }
  }, [open, system])

  // WebSocket connection for data preview
  React.useEffect(() => {
    if (!open) return

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
              return newMessages.slice(-10) // Keep last 10 messages
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
  }, [open, port])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validate
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

      // Build config
      const config = systemType === "equipment" ? equipmentConfig : metricsConfig

      const payload = {
        name: name.trim(),
        type: systemType,
        port: portNum,
        protocol,
        config,
        isEnabled,
      }

      const url = isEdit ? `/api/systems/${system.id}` : "/api/systems"
      const method = isEdit ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "저장에 실패했습니다")
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setLoading(false)
    }
  }

  const typeInfo = TYPE_LABELS[systemType]
  const Icon = typeInfo.icon

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col overflow-hidden">
        <SheetHeader className="shrink-0 p-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {isEdit ? "시설 수정" : "새 시설 추가"} - {typeInfo.label}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "시설 정보를 수정합니다."
              : `${typeInfo.label} 유형의 새 시설을 추가합니다.`}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 space-y-6 p-6 overflow-y-auto">
            {/* Name, Delimiter, and Enable toggle */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="name">시설명 *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 관제송신소 UPS"
                  required
                />
              </div>
              {systemType !== "equipment" && (
                <div className="w-20 space-y-2">
                  <Label htmlFor="delimiter">구분자</Label>
                  <Input
                    id="delimiter"
                    value={metricsConfig.delimiter}
                    onChange={(e) =>
                      setMetricsConfig({ ...metricsConfig, delimiter: e.target.value })
                    }
                    placeholder=","
                  />
                </div>
              )}
              <div className="flex items-center gap-2 pt-6">
                <Switch
                  id="enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
                <Label htmlFor="enabled" className="font-normal cursor-pointer">
                  활성화
                </Label>
              </div>
            </div>

            {/* Port config and Preview */}
            <div className="grid grid-cols-1 gap-6">
              <SystemPortConfig
                port={port}
                protocol={protocol}
                onPortChange={setPort}
                onProtocolChange={setProtocol}
              />
              <SystemDataPreview
                port={port}
                connected={wsConnected}
                messages={previewMessages}
              />
            </div>

            {/* Type-specific config */}
            <div className="border-t pt-4">
              {systemType === "equipment" ? (
                <SystemEquipmentConfig
                  config={equipmentConfig}
                  onChange={setEquipmentConfig}
                />
              ) : (
                <SystemMetricsConfig
                  config={metricsConfig}
                  onChange={setMetricsConfig}
                  typeLabel={typeInfo.label}
                  systemType={systemType}
                />
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <SheetFooter className="shrink-0 border-t p-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              취소
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "저장" : "추가"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
