"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { X, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DEFAULT_CRITICAL_CONFIRMATIONS,
  MAX_CRITICAL_CONFIRMATIONS,
  MIN_CRITICAL_CONFIRMATIONS,
} from "@/lib/equipment-alarm"
import type { EquipmentConfig } from "@/types"

interface SystemEquipmentConfigProps {
  config: EquipmentConfig
  onChange: (config: EquipmentConfig) => void
  layout?: "vertical" | "horizontal"
  className?: string
  disabled?: boolean
}

export function SystemEquipmentConfig({
  config,
  onChange,
  layout = "vertical",
  className,
  disabled = false,
}: SystemEquipmentConfigProps) {
  const [normalInput, setNormalInput] = React.useState("")
  const [criticalInput, setCriticalInput] = React.useState("")

  const addPattern = (
    type: "normalPatterns" | "criticalPatterns",
    value: string
  ) => {
    const trimmed = value.trim()
    const patterns = config[type] || []
    if (!trimmed || patterns.includes(trimmed)) return

    onChange({
      ...config,
      [type]: [...patterns, trimmed],
    })

    if (type === "normalPatterns") {
      setNormalInput("")
    } else {
      setCriticalInput("")
    }
  }

  const removePattern = (
    type: "normalPatterns" | "criticalPatterns",
    index: number
  ) => {
    const patterns = config[type] || []
    onChange({
      ...config,
      [type]: patterns.filter((_, i) => i !== index),
    })
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    type: "normalPatterns" | "criticalPatterns",
    value: string
  ) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addPattern(type, value)
    }
  }

  // Consecutive critical messages before the worker raises a fault. Empty = default (1):
  // only a facility fed by a noisy analogue sender needs more, and sets it here.
  const defaultConfirmations = DEFAULT_CRITICAL_CONFIRMATIONS
  const setConfirmations = (raw: string) => {
    const next = { ...config }
    if (raw.trim() === "") {
      delete next.criticalConfirmations
    } else {
      const n = Number.parseInt(raw, 10)
      if (!Number.isFinite(n)) return
      next.criticalConfirmations = Math.min(MAX_CRITICAL_CONFIRMATIONS, Math.max(MIN_CRITICAL_CONFIRMATIONS, n))
    }
    onChange(next)
  }
  const confirmationsField = (
    <div className="rounded-lg border bg-card p-4">
      <Label htmlFor="critical-confirmations" className="text-sm font-medium">
        심각 판정 연속 횟수
      </Label>
      <div className="mt-3 flex items-center gap-3">
        <Input
          id="critical-confirmations"
          type="number"
          inputMode="numeric"
          min={MIN_CRITICAL_CONFIRMATIONS}
          max={MAX_CRITICAL_CONFIRMATIONS}
          step={1}
          value={config.criticalConfirmations ?? ""}
          onChange={(e) => setConfirmations(e.target.value)}
          placeholder={String(defaultConfirmations)}
          className="w-24"
          disabled={disabled}
        />
        <span className="text-xs text-muted-foreground">
          {config.criticalConfirmations === undefined
            ? `기본값 ${defaultConfirmations}회 — 첫 심각 신호에 바로 알람`
            : `기본값은 ${defaultConfirmations}회`}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        심각 패턴이 이 횟수만큼 연속으로 수신돼야 알람을 냅니다. 프로그램이 보내는 상태(FMS·LCMS
        소프트웨어, 음성탐지기 PC)는 기본값 1회를 그대로 두고, 아날로그 탐지장비처럼 잡음 신호가
        섞이는 송신측만 2~3회로 올리세요. 비우면 기본값을 사용합니다.
      </p>
    </div>
  )

  if (layout === "horizontal") {
    return (
      <div className={cn("grid grid-cols-2 gap-4", className)}>
        {/* Normal patterns column */}
        <div className="rounded-lg border bg-card p-4">
          <Label className="flex items-center gap-2 text-sm font-medium text-green-500">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            정상 패턴
          </Label>
          <div className="mt-3 flex gap-2">
            <Input
              value={normalInput}
              onChange={(e) => setNormalInput(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, "normalPatterns", normalInput)}
              placeholder="패턴 입력"
              className="flex-1"
              disabled={disabled}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => addPattern("normalPatterns", normalInput)}
              disabled={disabled || !normalInput.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 min-h-[32px]">
            {config.normalPatterns.map((pattern, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="bg-green-500/10 text-green-500 hover:bg-green-500/20"
              >
                {pattern}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removePattern("normalPatterns", index)}
                    className="ml-1 hover:text-green-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {config.normalPatterns.length === 0 && (
              <span className="text-xs text-muted-foreground">
                패턴을 추가하세요
              </span>
            )}
          </div>
        </div>

        {/* Critical patterns column */}
        <div className="rounded-lg border bg-card p-4">
          <Label className="flex items-center gap-2 text-sm font-medium text-red-500">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            심각 패턴
          </Label>
          <div className="mt-3 flex gap-2">
            <Input
              value={criticalInput}
              onChange={(e) => setCriticalInput(e.target.value)}
              onKeyDown={(e) =>
                handleKeyDown(e, "criticalPatterns", criticalInput)
              }
              placeholder="패턴 입력"
              className="flex-1"
              disabled={disabled}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => addPattern("criticalPatterns", criticalInput)}
              disabled={disabled || !criticalInput.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 min-h-[32px]">
            {(config.criticalPatterns || []).map((pattern, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="bg-red-500/10 text-red-500 hover:bg-red-500/20"
              >
                {pattern}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removePattern("criticalPatterns", index)}
                    className="ml-1 hover:text-red-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {(!config.criticalPatterns || config.criticalPatterns.length === 0) && (
              <span className="text-xs text-muted-foreground">
                패턴을 추가하세요
              </span>
            )}
          </div>
        </div>

        <div className="col-span-2">{confirmationsField}</div>
      </div>
    )
  }

  // Original vertical layout
  return (
    <div className={cn("space-y-4", className)}>
      <div className="font-medium text-sm">상태 판단 패턴</div>
      <p className="text-xs text-muted-foreground">
        수신된 메시지가 패턴과 정확히 일치하면 해당 상태로 표시됩니다.
      </p>

      <div className="space-y-4">
        {/* Normal patterns */}
        <div className="space-y-2">
          <Label className="text-sm text-green-500">정상 패턴</Label>
          <div className="flex gap-2">
            <Input
              value={normalInput}
              onChange={(e) => setNormalInput(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, "normalPatterns", normalInput)}
              placeholder="예: OK, NORMAL, 정상"
              className="flex-1"
              disabled={disabled}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => addPattern("normalPatterns", normalInput)}
              disabled={disabled || !normalInput.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {config.normalPatterns.map((pattern, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="bg-green-500/10 text-green-500 hover:bg-green-500/20"
              >
                {pattern}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removePattern("normalPatterns", index)}
                    className="ml-1 hover:text-green-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {config.normalPatterns.length === 0 && (
              <span className="text-xs text-muted-foreground">
                패턴을 추가하세요
              </span>
            )}
          </div>
        </div>

        {/* Critical patterns */}
        <div className="space-y-2">
          <Label className="text-sm text-red-500">심각 패턴</Label>
          <div className="flex gap-2">
            <Input
              value={criticalInput}
              onChange={(e) => setCriticalInput(e.target.value)}
              onKeyDown={(e) =>
                handleKeyDown(e, "criticalPatterns", criticalInput)
              }
              placeholder="예: CRITICAL, FAIL, 심각"
              className="flex-1"
              disabled={disabled}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => addPattern("criticalPatterns", criticalInput)}
              disabled={disabled || !criticalInput.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(config.criticalPatterns || []).map((pattern, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="bg-red-500/10 text-red-500 hover:bg-red-500/20"
              >
                {pattern}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removePattern("criticalPatterns", index)}
                    className="ml-1 hover:text-red-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
            {(!config.criticalPatterns || config.criticalPatterns.length === 0) && (
              <span className="text-xs text-muted-foreground">
                패턴을 추가하세요
              </span>
            )}
          </div>
        </div>

        {confirmationsField}
      </div>
    </div>
  )
}
