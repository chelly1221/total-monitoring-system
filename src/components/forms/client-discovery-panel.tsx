"use client"

import * as React from "react"
import { Loader2, RefreshCw, MonitorCheck, Check, Volume2, VolumeX } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { DiscoveredClient } from "@/types"
import { CLIENT_KIND_PORTS, clientKindName, clientKindOf, upsUnitLabel, type ClientKind } from "@/lib/client-kinds"

interface ClientDiscoveryPanelProps {
  /** Client id currently bound to this facility (highlighted, cannot be re-selected). */
  selectedClientId?: string | null
  /** UPS forms: the card of the selected client this facility receives. */
  selectedUnit?: 1 | 2
  /** Facility id being edited; its own registration is not treated as a conflict. */
  currentSystemId?: string | null
  /** `unit` is set when a card of a UPS client was picked. */
  onSelect: (client: DiscoveredClient, suggestedPort: number | null, unit?: 1 | 2) => void
  disabled?: boolean
  className?: string
  /** Client kinds to list; others discovered on the LAN are hidden. */
  allowedKinds?: ClientKind[]
}

/** Send the identify command; shared by the panel rows and the edit page. */
export async function identifyClient(ip: string, discoveryPort: number = CLIENT_KIND_PORTS.sound): Promise<boolean> {
  try {
    const response = await fetch("/api/discovery/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, discoveryPort }),
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
  selectedUnit,
  currentSystemId,
  onSelect,
  disabled = false,
  className,
  allowedKinds,
}: ClientDiscoveryPanelProps) {
  const [allClients, setAllClients] = React.useState<DiscoveredClient[] | null>(null)
  // Equipment forms hide UPS clients and the UPS forms hide the pattern clients.
  const clients = React.useMemo(
    () => allClients && allowedKinds ? allClients.filter(c => allowedKinds.includes(clientKindOf(c.kind))) : allClients,
    [allClients, allowedKinds],
  )
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
      setAllClients((data.clients as DiscoveredClient[]).filter(client => client.kind !== 'pi'))
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

  const handleIdentify = async (client: DiscoveredClient) => {
    setIdentifying(client.id)
    await identifyClient(client.ip, client.discoveryPort)
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
          같은 네트워크에서 실행 중인 음성탐지기·네트워크 ping 감시·2026 1레이더 UPS 클라이언트를 찾지 못했습니다.
          클라이언트가 실행 중인지, 같은 서브넷인지 확인한 뒤 다시 검색하세요.
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="max-h-44 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground">
              <tr className="text-left">
                <th className="py-0.5 pr-2 font-normal">장비명 / 프로그램</th>
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
                // One UPS PC feeds two facilities: offer each card separately and only
                // block the card another facility already receives.
                const reportedCards = (client.units ?? []).map(u => u.unit).filter((u): u is 1 | 2 => u === 1 || u === 2)
                const upsCards: readonly (1 | 2)[] = client.kind !== 'ups' ? [] : reportedCards.length ? reportedCards : [1, 2]
                const cardRegistration = (unit: 1 | 2) => client.registeredUnits?.find(r => r.unit === unit) ?? null
                const cardBoundElsewhere = (unit: 1 | 2) => {
                  const registration = cardRegistration(unit)
                  return registration !== null && registration.systemId !== currentSystemId
                }
                return (
                  <tr
                    key={client.id}
                    className={cn("border-t", isSelected && "bg-primary/10")}
                  >
                    <td className="py-1 pr-2 font-medium">
                      {client.name || <span className="text-muted-foreground">(미등록)</span>}
                      <div className="text-[10px] font-normal text-muted-foreground">{clientKindName(client.kind)}</div>
                    </td>
                    <td className="py-1 pr-2">{client.host}</td>
                    <td className="py-1 pr-2 font-mono">{client.ip}</td>
                    <td className="py-1 pr-2 font-mono text-muted-foreground">{client.mac || "-"}</td>
                    <td className="py-1 pr-2">
                      <span className="inline-flex items-center gap-1">
                        {client.kind === 'ups' ? (
                          (client.units ?? []).map(u => (
                            <Badge key={u.unit} variant={u.alarm ? 'destructive' : 'secondary'} className="px-1.5 py-0 text-[10px]" title={u.target ? `서버 ${u.target.ip}:${u.target.port}` : '서버 미연결'}>
                              UPS#{u.unit} {!client.running ? '정지' : u.alarm === null ? '대기' : u.alarm ? '경보' : '정상'}
                            </Badge>
                          ))
                        ) : client.kind === 'ping' ? (
                          <Badge variant={client.alarm ? 'destructive' : 'secondary'} className="px-1.5 py-0 text-[10px]">
                            {!client.running ? '정지' : client.alarm === null ? '대기' : client.alarm ? '장애' : '정상'}
                          </Badge>
                        ) : <>{client.muted ? (
                          <VolumeX className="h-3 w-3 text-amber-500" />
                        ) : (
                          <Volume2 className="h-3 w-3 text-muted-foreground" />
                        )}
                        {client.sound ? (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">소리</Badge>
                        ) : (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">무음</Badge>
                        )}</>}
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      {client.kind === 'ups' ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          {upsCards.map(unit => {
                            const registration = cardRegistration(unit)
                            const elsewhere = cardBoundElsewhere(unit)
                            return registration ? (
                              <Badge
                                key={unit}
                                variant={elsewhere ? "outline" : "secondary"}
                                className="px-1.5 py-0 text-[10px]"
                                title={registration.systemName}
                              >
                                {upsUnitLabel(unit)} {elsewhere ? `등록됨: ${registration.systemName}` : "이 시설"}
                              </Badge>
                            ) : (
                              <span key={unit} className="text-muted-foreground">{upsUnitLabel(unit)} 미등록</span>
                            )
                          })}
                        </span>
                      ) : client.registered ? (
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
                          onClick={() => void handleIdentify(client)}
                          disabled={identifying !== null}
                          title="해당 PC 화면에 확인 알림을 띄웁니다"
                        >
                          {identifying === client.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <MonitorCheck className="h-3 w-3" />
                          )}
                          PC 확인
                        </Button>
                        {client.kind === 'ups' ? upsCards.map(unit => {
                          const cardSelected = isSelected && selectedUnit === unit
                          const elsewhere = cardBoundElsewhere(unit)
                          return (
                            <Button
                              key={unit}
                              type="button"
                              size="sm"
                              variant={cardSelected ? "secondary" : "default"}
                              className="h-6 gap-1 px-2 text-xs"
                              onClick={() => onSelect(client, suggestedPort, unit)}
                              disabled={disabled || cardSelected || elsewhere}
                              title={elsewhere ? `${upsUnitLabel(unit)}은(는) 이미 다른 시설에 등록되어 있습니다` : undefined}
                            >
                              <Check className="h-3 w-3" />
                              {cardSelected ? `${upsUnitLabel(unit)} 선택됨` : `${upsUnitLabel(unit)} 선택`}
                            </Button>
                          )
                        }) : (
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
                        )}
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
