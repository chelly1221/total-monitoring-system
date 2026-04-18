"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Plus, Trash2, Play, Loader2, ListPlus } from "lucide-react"
import type { DisplayItem } from "@/types"

interface SystemCustomCodeProps {
  code: string | undefined
  onChange: (code: string | undefined) => void
  latestRawData: string | undefined
  disabled?: boolean
  onTestResult?: (result: Record<string, number | string> | null) => void
  displayItems?: DisplayItem[]
  onAutoPopulate?: (newItems: DisplayItem[]) => void
}

export function SystemCustomCode({ code, onChange, latestRawData, disabled = false, onTestResult, displayItems, onAutoPopulate }: SystemCustomCodeProps) {
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; result?: Record<string, number | string>; error?: string } | null>(null)
  const isActive = !!code?.trim()

  const handleTest = async () => {
    if (!code?.trim() || !latestRawData) return
    setTesting(true)
    setTestResult(null)

    try {
      const response = await fetch("/api/systems/test-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, rawData: latestRawData }),
      })
      const data = await response.json()
      setTestResult(data)
      onTestResult?.(data.success && data.result ? data.result : null)
    } catch {
      setTestResult({ success: false, error: "서버 연결 오류" })
      onTestResult?.(null)
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = () => {
    onChange(undefined)
    setTestResult(null)
    onTestResult?.(null)
  }

  if (!isActive) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-muted-foreground">커스텀 파싱 코드</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onChange('// raw 변수에 수신 데이터가 전달됩니다\n// 반환값: { "항목명": 숫자값, ... }\nconst parts = raw.split(",");\nreturn {\n  \n};')}
          disabled={disabled}
        >
          <Plus className="h-3 w-3 mr-1" />
          추가
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">커스텀 파싱 코드</span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleTest}
            disabled={disabled || testing || !latestRawData}
            title={!latestRawData ? "테스트할 수신 데이터가 없습니다" : ""}
          >
            {testing ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            테스트
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={disabled}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            삭제
          </Button>
        </div>
      </div>

      <textarea
        value={code}
        onChange={(e) => {
          onChange(e.target.value)
          setTestResult(null)
          onTestResult?.(null)
        }}
        className="w-full h-32 rounded border bg-zinc-950 px-2 py-1.5 font-mono text-xs text-green-400 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder={'// raw 변수에 수신 데이터가 전달됩니다\nconst parts = raw.split(",");\nreturn { "항목명": parseFloat(parts[0]) };'}
        disabled={disabled}
        spellCheck={false}
      />

      <div className="text-[10px] text-muted-foreground">
        <code>raw</code> 변수에 수신 데이터가 전달됩니다. 반환값: {`{ "항목명": 숫자값, ... }`}
      </div>

      {testResult && (
        <div className={`rounded px-2 py-1.5 text-xs ${testResult.success ? "bg-green-950/50 border border-green-800" : "bg-red-950/50 border border-red-800"}`}>
          {testResult.success && testResult.result ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <div className="text-green-400 font-medium">파싱 성공</div>
                {onAutoPopulate && displayItems && (() => {
                  const existingNames = new Set(displayItems.map(i => i.name))
                  const missingKeys = Object.keys(testResult.result!).filter(k => !existingNames.has(k))
                  const allExist = missingKeys.length === 0
                  return (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-5 px-2 text-[10px]"
                      disabled={disabled || allExist}
                      onClick={() => {
                        const newItems: DisplayItem[] = missingKeys.map(name => ({
                          name,
                          index: 0,
                          unit: "",
                          warning: null,
                          critical: null,
                          chartGroup: null,
                          alarmEnabled: true,
                        }))
                        onAutoPopulate([...displayItems, ...newItems])
                      }}
                    >
                      <ListPlus className="h-3 w-3 mr-1" />
                      {allExist ? "모든 항목 등록됨" : `항목 자동 생성 (${missingKeys.length}개)`}
                    </Button>
                  )
                })()}
              </div>
              {Object.entries(testResult.result).map(([key, val]) => (
                <div key={key} className="flex gap-2 text-green-300">
                  <span className="text-muted-foreground">{key}:</span>
                  <span className="font-mono">{val}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-red-400">{testResult.error}</div>
          )}
        </div>
      )}
    </div>
  )
}
