"use client"

import * as React from "react"
import { Loader2, RefreshCw, MonitorCheck, Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { clientDiscoveryRows } from "@/lib/client-discovery-rows"
import './client-discovery-panel.css'
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
  const rows = React.useMemo(() => clientDiscoveryRows(clients ?? []), [clients])
  const [expandedRow, setExpandedRow] = React.useState<string | null>(null)
  const panelId = React.useId()
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
        <ul className="client-discovery-list" aria-label="탐지된 장비">
          {rows.map(({ key, client, unit, registration }) => {
            const isSelected = selectedClientId === client.id && (unit === undefined || selectedUnit === unit)
            const boundElsewhere = !!registration && registration.systemId !== currentSystemId
            const expanded = expandedRow === key
            const detailsId = panelId + '-' + encodeURIComponent(key)
            const name = client.name || client.host || client.ip
            const label = unit === undefined ? name : name + ' ' + upsUnitLabel(unit)
            const reportedUnit = client.units?.find(item => item.unit === unit)
            const target = unit === undefined ? client.target : reportedUnit?.target
            const alarm = unit === undefined ? client.alarm : reportedUnit?.alarm
            const status = client.kind === 'ups' || client.kind === 'ping'
              ? client.running === false ? '정지' : alarm == null ? '대기' : alarm ? '경보' : '정상'
              : client.sound ? '소리 감지' : '무음'
            return (
              <li key={key} className={cn("client-discovery-item", isSelected && "bg-primary/10")}>
                <div className="client-discovery-summary">
                  <div className="client-discovery-name" title={label}>
                    <span>{name}</span>
                    {unit !== undefined && <strong>{upsUnitLabel(unit)}</strong>}
                  </div>
                  <span className="client-discovery-registration" data-available={!registration}>
                    {registration ? registration.systemId === currentSystemId ? '이 시설' : '등록됨' : '미등록'}
                  </span>
                  <Button type="button" variant="outline" size="sm"
                    aria-label={label + ' 상세'} aria-expanded={expanded} aria-controls={detailsId}
                    onClick={() => setExpandedRow(expanded ? null : key)}>
                    {expanded ? '접기' : '상세'}
                  </Button>
                  <Button type="button" size="sm" variant={isSelected ? 'secondary' : 'default'}
                    aria-label={label + (isSelected ? ' 선택됨' : ' 선택')}
                    onClick={() => onSelect(client, suggestedPort, unit)}
                    disabled={disabled || isSelected || boundElsewhere}
                    title={boundElsewhere ? registration.systemName + '에 등록되어 있습니다' : undefined}>
                    {isSelected && <Check className="h-3 w-3" />}
                    {isSelected ? '선택됨' : '선택'}
                  </Button>
                </div>
                {expanded && (
                  <div id={detailsId} className="client-discovery-details" role="region" aria-label={label + ' 상세 정보'}>
                    <dl>
                      <dt>장비명</dt><dd>{label}</dd>
                      <dt>프로그램</dt><dd>{clientKindName(client.kind)}{client.ver && ' · v' + client.ver}</dd>
                      <dt>PC 이름</dt><dd>{client.host || '—'}</dd>
                      <dt>IP 주소</dt><dd>{client.ip}</dd>
                      <dt>MAC 주소</dt><dd>{client.mac || '—'}</dd>
                      <dt>상태</dt><dd><Badge variant={alarm || client.sound ? 'destructive' : 'secondary'}>{status}</Badge>{client.kind !== 'ups' && client.kind !== 'ping' && client.muted && ' · 음소거'}</dd>
                      <dt>등록 시설</dt><dd>{registration?.systemName || '미등록'}</dd>
                      <dt>전송 대상</dt><dd>{target ? target.ip + ':' + target.port : '서버 미연결'}</dd>
                    </dl>
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => void handleIdentify(client)} disabled={identifying !== null || disabled}
                      title="해당 PC 화면에 확인 알림을 띄웁니다">
                      {identifying === client.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <MonitorCheck className="h-3 w-3" />}
                      PC 확인
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
