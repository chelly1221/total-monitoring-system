"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Loader2, Pause, Play } from "lucide-react"
import { matchesDataConditions } from "@/lib/data-match"
import type { DataMatchCondition } from "@/types"

interface SystemDataPreviewProps {
  port: string
  connected: boolean
  messages: string[]
  className?: string
  label?: string
  dataMatchConditions?: DataMatchCondition[]
}

export function SystemDataPreview({
  port,
  connected,
  messages,
  className,
  label,
  dataMatchConditions: conditions,
}: SystemDataPreviewProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [paused, setPaused] = React.useState(false)
  const frozenMessagesRef = React.useRef<string[]>([])

  // Filter messages by data match conditions
  const filteredMessages = React.useMemo(() => {
    if (!conditions || conditions.length === 0) return messages
    return messages.filter((msg) => matchesDataConditions(msg, conditions))
  }, [messages, conditions])

  // When pausing, snapshot current filtered messages; when resuming, clear snapshot
  const displayMessages = paused ? frozenMessagesRef.current : filteredMessages

  const handleTogglePause = () => {
    if (!paused) {
      frozenMessagesRef.current = filteredMessages
    }
    setPaused((p) => !p)
  }

  React.useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayMessages, paused])

  const portNum = parseInt(port, 10)
  const validPort = !isNaN(portNum) && portNum >= 1 && portNum <= 65535

  return (
    <>
      {(label || validPort) && (
        <div className="flex items-center justify-between gap-2 text-xs mb-1">
          <div className="flex items-center gap-1.5">
            {label && <div className="font-medium text-muted-foreground">{label}</div>}
            {validPort && messages.length > 0 && (
              <button
                onClick={handleTogglePause}
                className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                title={paused ? "재개" : "일시정지"}
              >
                {paused ? (
                  <Play className="h-3 w-3" />
                ) : (
                  <Pause className="h-3 w-3" />
                )}
              </button>
            )}
          </div>
          {validPort && (
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  connected ? "bg-green-500" : "bg-yellow-500"
                )}
              />
              <span className="text-muted-foreground">
                {connected ? "연결됨" : "대기 중..."}
              </span>
            </div>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className={cn(
          "rounded-md border bg-muted/30 p-3 font-mono text-xs overflow-y-auto",
          className || "h-32"
        )}
      >
        {!validPort ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            포트 번호를 입력하세요
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            데이터 수신 대기 중...
          </div>
        ) : (
          <div className="space-y-1">
            {displayMessages.map((msg, index) => (
              <div key={index} className="text-green-400">
                <span className="text-muted-foreground mr-2">&gt;</span>
                {msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
