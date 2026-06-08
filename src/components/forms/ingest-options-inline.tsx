"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface IngestOptionsInlineProps {
  encoding: "buffer" | "utf8"
  onEncodingChange: (value: "buffer" | "utf8") => void
  offlineThresholdMin: string
  onOfflineThresholdChange: (value: string) => void
  disabled?: boolean
  compact?: boolean
}

/**
 * Inline controls for the per-device wire encoding and offline threshold.
 * Rendered next to the port/protocol inputs on the system/ups editor bars.
 */
export function IngestOptionsInline({
  encoding,
  onEncodingChange,
  offlineThresholdMin,
  onOfflineThresholdChange,
  disabled,
  compact,
}: IngestOptionsInlineProps) {
  const labelCls = compact ? "whitespace-nowrap text-xs text-muted-foreground" : "whitespace-nowrap"
  const selCls = compact ? "w-24 h-7 text-xs" : "w-28"
  const inputCls = compact ? "w-16 h-7 text-xs" : "w-20"
  const gap = compact ? "gap-1.5" : "gap-2"
  return (
    <>
      <div className={`flex items-center ${gap}`}>
        <Label className={labelCls}>인코딩</Label>
        <Select
          value={encoding}
          onValueChange={(value) => onEncodingChange(value as "buffer" | "utf8")}
          disabled={disabled}
        >
          <SelectTrigger className={selCls}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="buffer">20바이트</SelectItem>
            <SelectItem value="utf8">UTF-8</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className={`flex items-center ${gap}`}>
        <Label className={labelCls}>오프라인(분)</Label>
        <Input
          type="number"
          min={1}
          value={offlineThresholdMin}
          onChange={(e) => onOfflineThresholdChange(e.target.value)}
          placeholder="기본"
          className={inputCls}
          disabled={disabled}
        />
      </div>
    </>
  )
}

/**
 * Build the encoding + offlineThreshold payload fields shared by all editors.
 * offlineThresholdMin is minutes (empty = use global default → null); encoding is
 * sent as-is. Returns null offlineThreshold for empty/invalid input.
 */
export function buildIngestPayloadFields(
  encoding: "buffer" | "utf8",
  offlineThresholdMin: string,
): { encoding: "buffer" | "utf8"; offlineThreshold: number | null } {
  const mins = offlineThresholdMin.trim() ? parseInt(offlineThresholdMin, 10) : NaN
  return {
    encoding,
    offlineThreshold: !isNaN(mins) && mins >= 1 ? mins * 60000 : null,
  }
}

/** Convert a stored offlineThreshold (ms) back to the minutes string for the form. */
export function offlineThresholdToMinutes(ms: number | null | undefined): string {
  return ms != null ? String(Math.round(ms / 60000)) : ""
}
