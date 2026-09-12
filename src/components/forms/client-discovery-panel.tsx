"use client"

import * as React from "react"
import { Loader2, RefreshCw, MonitorCheck, Check, Volume2, VolumeX } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DiscoveredClient } from "@/types"

interface ClientDiscoveryPanelProps {
  /** Client id currently bound to this facility (highlighted, cannot be re-selected). */
  selectedClientId?: string | null
  /** Facility id being edited; its own registration is not treated as a conflict. */
  currentSystemId?: string | null
  onSelect: (client: DiscoveredClient, suggestedPort: number | null) => void
  disabled?: boolean
  className?: string
}

/** Send the identify command; shared by the panel rows and the edit page. */
export async function identifyClient(ip: string): Promise<boolean> {
  try {
    const response = await fetch("/api/discovery/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      toast.error(data.error || "PC 확인 요청에 실패했습니다")
      return false
    }
    toast.success("해당 PC에서 확인 알림을 표시했습니다")
    return true
  } catch {
    toast.error("PC 확인 요청에 실패했습니다")
    return false
  }
}

/**
 * On-demand LAN scan for TMS SoundSense clients. Each search sends a single
 * broadcast probe per interface (repeated once); nothing runs in the background.
 */
export function ClientDiscoveryPanel({
  selectedClientId,
  currentSystemId,
  onSelect,
  disabled = false,
  className,
}: ClientDiscoveryPanelProps) {
  const [clients, setClients] = React.useState<DiscoveredClient[] | null>(null)
  const [suggestedPort, setSuggestedPort] = React.useState<number | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [identifying, setIdentifying] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const scan = React.useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const response = await fetch("/api/discovery/clients", { cache: "no-store" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "PC 탐지에 실패했습니다")
      }
      const data = await response.json()
      setClients(data.clients as DiscoveredClient[])
      setSuggestedPort(typeof data.suggestedPort === "number" ? data.suggestedPort : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "PC 탐지에 실패했습니다")
    } finally {
      setScanning(false)
    }
  }, [])

  // One automatic scan when the panel opens; afterwards only on demand.
  React.useEffect(() => {
    void scan()
  }, [scan])

  const handleIdentify = async (ip: string) => {
    setIdentifying(ip)
    await identifyClient(ip)
    setIdentifying(null)
  }

  return (
    <div className={cn("flex flex-col gap-1.5 rounded border bg-card px-2 py-1.5", className)}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          탐지된 PC
          {clients && <span className="ml-1 normal-case">({clients.length}대)</span>}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => void scan()}
          disabled={scanning || disabled}
        >
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {scanning ? "검색 중" : "다시 검색"}
        </Button>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      {clients && clients.length === 0 && !scanning && !error && (
        <div className="py-2 text-xs text-muted-foreground">
          같은 네트워크에서 실행 중인 TMS SoundSense 클라이언트를 찾지 못했습니다.
          클라이언트가 실행 중인지, 같은 서브넷인지 확인한 뒤 다시 검색하세요.
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="max-h-44 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground">
              <tr className="text-left">
                <th className="py-0.5 pr-2 font-normal">장비명</th>
                <th className="py-0.5 pr-2 font-normal">PC 이름</th>
                <th className="py-0.5 pr-2 font-normal">IP</th>
                <th className="py-0.5 pr-2 font-normal">MAC</th>
                <th className="py-0.5 pr-2 font-normal">상태</th>
                <th className="py-0.5 pr-2 font-normal">등록</th>
                <th className="py-0.5 font-normal text-right">동작</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const isSelected = selectedClientId === client.id
                const boundElsewhere =
                  client.registered !== null && client.registered.systemId !== currentSystemId
                return (
                  <tr
                    key={client.id}
                    className={cn("border-t", isSelected && "bg-primary/10")}
                  >
                    <td className="py-1 pr-2 font-medium">
                      {client.name || <span className="text-muted-foreground">(미등록)</span>}
                    </td>
                    <td className="py-1 pr-2">{client.host}</td>
                    <td className="py-1 pr-2 font-mono">{client.ip}</td>
                    <td className="py-1 pr-2 font-mono text-muted-foreground">{client.mac || "-"}</td>
                    <td className="py-1 pr-2">
                      <span className="inline-flex items-center gap-1">
                        {client.muted ? (
                          <VolumeX className="h-3 w-3 text-amber-500" />
                        ) : (
                          <Volume2 className="h-3 w-3 text-muted-foreground" />
                        )}
                        {client.sound ? (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">소리</Badge>
                        ) : (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">무음</Badge>
                        )}
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      {client.registered ? (
                        <Badge
                          variant={boundElsewhere ? "outline" : "secondary"}
                          className="px-1.5 py-0 text-[10px]"
                          title={client.registered.systemName}
                        >
                          {boundElsewhere ? `등록됨: ${client.registered.systemName}` : "이 시설"}
                        </Badge>
                      ) : client.target ? (
                        <span className="text-muted-foreground" title={`${client.target.ip}:${client.target.port}`}>
                          다른 서버
                        </span>
                      ) : (
                        <span className="text-muted-foreground">미등록</span>
                      )}
                    </td>
                    <td className="py-1 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-xs"
                          onClick={() => void handleIdentify(client.ip)}
                          disabled={identifying !== null}
                          title="해당 PC 화면에 확인 알림을 띄웁니다"
                        >
                          {identifying === client.ip ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <MonitorCheck className="h-3 w-3" />
                          )}
                          PC 확인
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={isSelected ? "secondary" : "default"}
                          className="h-6 gap-1 px-2 text-xs"
                          onClick={() => onSelect(client, suggestedPort)}
                          disabled={disabled || isSelected || boundElsewhere}
                          title={boundElsewhere ? "이미 다른 시설에 등록된 PC입니다" : undefined}
                        >
                          <Check className="h-3 w-3" />
                          {isSelected ? "선택됨" : "선택"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
