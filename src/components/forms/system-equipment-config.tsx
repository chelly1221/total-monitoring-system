"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { X, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
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
      </div>
    </div>
  )
}
