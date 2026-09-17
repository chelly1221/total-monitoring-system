"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { useWebSocket } from "@/hooks/useWebSocket"
import { describePingEvent, type PingEventView } from "@/lib/ping-event-rules"
import { cn } from "@/lib/utils"
import type { WebSocketMessage } from "@/types"

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Failure / recovery events the bound 네트워크 ping 감시 client reported for this
 * facility, newest first. Refreshes when the client posts new events.
 */
export function PingEventLog({ systemId }: { systemId: string }) {
  const [events, setEvents] = React.useState<PingEventView[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/ping-events?systemId=${encodeURIComponent(systemId)}&limit=100`, { cache: "no-store" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "ping 장애 내역을 불러오지 못했습니다")
      setEvents(data.events as PingEventView[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "ping 장애 내역을 불러오지 못했습니다")
    }
  }, [systemId])

  React.useEffect(() => {
    void load()
  }, [load])

  const onMessage = React.useCallback((message: WebSocketMessage) => {
    if (message.type === "ping-events" && message.data.systemId === systemId) void load()
  }, [load, systemId])
  useWebSocket({ onMessage })

  return (
    <div className="flex-1 flex flex-col overflow-hidden border rounded p-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
        ping 감시 대상 장애 내역
        {events && <span className="ml-1 normal-case">({events.length}건)</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {error && <div className="text-[10px] text-destructive">{error}</div>}
        {!events && !error && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
          </div>
        )}
        {events && events.length === 0 && (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            아직 보고된 장애·복구 내역이 없습니다
          </div>
        )}
        {events && events.length > 0 && (
          <table className="w-full text-[11px]">
            <tbody>
              {events.map(event => {
                const failed = event.status === "장애 발생"
                return (
                  <tr key={event.id} className="border-t border-border/50">
                    <td className="py-0.5 pr-2 whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(event.occurredAt)}</td>
                    <td className={cn("py-0.5 pr-2 whitespace-nowrap font-medium", failed ? "text-[#f87171]" : "text-[#4ade80]")}>{event.status}</td>
                    <td className="py-0.5 truncate">{describePingEvent(event)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
