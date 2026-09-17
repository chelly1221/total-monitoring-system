"use client"

import * as React from "react"
import { Loader2, MonitorCheck, Unlink, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClientDiscoveryPanel, identifyClient } from "@/components/forms/client-discovery-panel"
import { clientKindName, discoveryPortFor, upsUnitLabel, type ClientKind } from "@/lib/client-kinds"
import { buildUpsClientPreset, isUpsClientPreset, upsClientUnit } from "@/lib/ups-client-preset"
import type { DiscoveredClient, EquipmentConfig, MetricsConfig, SoundClientInfo } from "@/types"

export type RegistrationMode = "manual" | "auto"

export const SOUND_CLIENT_ON = "SOUND"
export const SOUND_CLIENT_OFF = "SILENCE"

/** Form values to apply when the operator picks a discovered PC. */
export function buildClientSelection(client: DiscoveredClient, suggestedPort: number | null, previous: EquipmentConfig) {
  const info: SoundClientInfo = {
    id: client.id,
    name: client.name,
    host: client.host,
    ip: client.ip,
    mac: client.mac || undefined,
    ver: client.ver || undefined,
    kind: client.kind ?? 'sound',
    discoveryPort: client.discoveryPort ?? discoveryPortFor(client.kind),
    serverIp: client.serverIp,
  }
  // The client's old destination may belong to another server or facility.
  // Use this server's free port suggestion instead of silently sharing a port.
  const port = suggestedPort
  const hasPatterns = previous.normalPatterns.length > 0 && (previous.criticalPatterns?.length ?? 0) > 0
  const sameKind = (previous.client?.kind ?? 'sound') === (client.kind ?? 'sound')
  const on = client.kind === 'ping' ? 'PING_FAIL' : SOUND_CLIENT_ON
  const off = client.kind === 'ping' ? 'PING_OK' : SOUND_CLIENT_OFF
  const config: EquipmentConfig = {
    ...previous,
    normalPatterns: previous.client && sameKind && hasPatterns ? previous.normalPatterns : [off],
    criticalPatterns: previous.client && sameKind && hasPatterns ? previous.criticalPatterns : [on],
    matchMode: "exact",
    client: info,
  }
  return {
    name: client.name || client.host,
    port: port != null ? String(port) : "",
    protocol: "udp" as const,
    encoding: "utf8" as const,
    config,
  }
}

/**
 * Form values for a UPS facility fed by one card of a discovered UPS client: this
 * server's free port, UTF-8 JSON, and the parser/display-item preset for that card
 * (kept when the operator already tuned the same preset).
 */
export function buildUpsClientSelection(client: DiscoveredClient, unit: 1 | 2, suggestedPort: number | null, previous: MetricsConfig) {
  const info: SoundClientInfo = {
    id: client.id,
    name: client.name,
    host: client.host,
    ip: client.ip,
    mac: client.mac || undefined,
    ver: client.ver || undefined,
    kind: 'ups',
    unit,
    discoveryPort: client.discoveryPort ?? discoveryPortFor('ups'),
    serverIp: client.serverIp,
  }
  const keepItems = previous.client?.id === client.id && previous.client.unit === unit && isUpsClientPreset(previous, unit) && previous.displayItems.length > 0
  const config: MetricsConfig = {
    ...previous,
    ...(keepItems ? {} : buildUpsClientPreset(unit)),
    client: info,
  }
  return {
    name: `${client.name || client.host} ${upsUnitLabel(unit)}`,
    port: suggestedPort != null ? String(suggestedPort) : "",
    protocol: "udp" as const,
    encoding: "utf8" as const,
    config,
  }
}

/** Push the server address and UPS number to a UPS client after the facility is saved. */
export async function provisionUpsClient({ client, port, facilityName }: { client: SoundClientInfo; port: number; facilityName: string }): Promise<SoundClientInfo | null> {
  const unit = upsClientUnit(client.unit)
  try {
    const response = await fetch("/api/discovery/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip: client.ip, port, unit, name: client.name || facilityName, discoveryPort: client.discoveryPort ?? discoveryPortFor('ups'), serverIp: client.serverIp }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      toast.warning(`시설은 저장되었지만 PC 설정 전송에 실패했습니다: ${data.error || "응답 없음"}`)
      return null
    }
    toast.success(`PC에 서버 주소와 ${upsUnitLabel(unit)} 전송 설정을 보냈습니다`)
    return { ...client, provisionedAt: new Date().toISOString() }
  } catch {
    toast.warning("시설은 저장되었지만 PC 설정 전송에 실패했습니다")
    return null
  }
}

interface ProvisionArgs {
  client: SoundClientInfo
  port: number
  config: EquipmentConfig
  facilityName: string
}

/**
 * Push target/payload settings to the client after the facility is saved.
 * Returns the client info with provisionedAt set, or null when the push failed
 * (the facility itself is already saved; the operator is told to retry).
 */
export async function provisionSoundClient({ client, port, config, facilityName }: ProvisionArgs): Promise<SoundClientInfo | null> {
  const on = config.criticalPatterns?.[0]?.trim()
  const off = config.normalPatterns?.[0]?.trim()
  if (!on || !off) {
    toast.warning("정상/심각 패턴이 없어 PC에 설정을 전송하지 못했습니다")
    return null
  }
  try {
    const response = await fetch("/api/discovery/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip: client.ip, port, on, off, name: client.name || facilityName, discoveryPort: client.discoveryPort ?? discoveryPortFor(client.kind), serverIp: client.serverIp }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      toast.warning(`시설은 저장되었지만 PC 설정 전송에 실패했습니다: ${data.error || "응답 없음"}`)
      return null
    }
    toast.success("PC에 서버 주소와 전송 설정을 보냈습니다")
    return { ...client, provisionedAt: new Date().toISOString() }
  } catch {
    toast.warning("시설은 저장되었지만 PC 설정 전송에 실패했습니다")
    return null
  }
}

interface SoundClientSectionProps {
  mode: RegistrationMode
  onModeChange: (mode: RegistrationMode) => void
  client: SoundClientInfo | null | undefined
  currentSystemId?: string | null
  /** When false only the linked-PC summary and the PC 확인 button are shown. */
  isEditMode: boolean
  onSelect: (client: DiscoveredClient, suggestedPort: number | null) => void
  onUnlink: () => void
  /** Client kinds offered in the discovery list (equipment forms: sound + ping, UPS forms: ups). */
  allowedKinds?: ClientKind[]
  /** UPS forms: which card of the UPS client feeds this facility, with its change handler. */
  upsUnit?: 1 | 2
  onUpsUnitChange?: (unit: 1 | 2) => void
}

/**
 * 등록 방식 (수동/자동) switch, the linked-PC summary with PC 확인, and the
 * on-demand discovery list. Rendered under the basic-info bar of equipment forms.
 */
export function SoundClientSection({
  mode,
  onModeChange,
  client,
  currentSystemId,
  isEditMode,
  onSelect,
  onUnlink,
  allowedKinds,
  upsUnit,
  onUpsUnitChange,
}: SoundClientSectionProps) {
  const [showPanel, setShowPanel] = React.useState(false)
  const [identifying, setIdentifying] = React.useState(false)

  const panelOpen = isEditMode && mode === "auto" && (!client || showPanel)

  // Reset the "다른 PC 선택" expansion when leaving edit mode or switching client.
  React.useEffect(() => {
    if (!isEditMode) setShowPanel(false)
  }, [isEditMode])

  if (!isEditMode && !client) return null

  const handleIdentify = async () => {
    if (!client) return
    setIdentifying(true)
    await identifyClient(client.ip, client.discoveryPort)
    setIdentifying(false)
  }

  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      <div className="flex flex-wrap items-center gap-3 rounded border bg-card px-2 py-1.5">
        {isEditMode && (
          <div className="flex items-center gap-1.5">
            <Label className="whitespace-nowrap text-xs text-muted-foreground">등록 방식</Label>
            <Select
              value={mode}
              onValueChange={(value) => {
                const next = value as RegistrationMode
                onModeChange(next)
                if (next === "manual" && client) onUnlink()
              }}
            >
              <SelectTrigger className="w-32 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">수동 입력</SelectItem>
                <SelectItem value="auto">자동 탐지 (PC)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {client ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">연결된 PC</span>
            <span className="font-medium">{client.name || client.host}</span>
            <span className="text-muted-foreground">
              {clientKindName(client.kind)}
              {" · "}
              {client.host}
              {" · "}
              <span className="font-mono">{client.ip}</span>
              {client.mac && <> · <span className="font-mono">{client.mac}</span></>}
              {client.ver && <> · v{client.ver}</>}
            </span>
            {client.kind === 'ups' && (
              isEditMode && mode === "auto" && onUpsUnitChange ? (
                <Select value={String(upsUnit ?? client.unit ?? 1)} onValueChange={(value) => onUpsUnitChange(upsClientUnit(value))}>
                  <SelectTrigger className="w-24 h-6 text-xs" title="이 시설이 받을 UPS">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">UPS#1 (3상)</SelectItem>
                    <SelectItem value="2">UPS#2 (단상)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="rounded border px-1.5 py-0.5 text-[10px]">{upsUnitLabel(client.unit)}</span>
              )
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => void handleIdentify()}
              disabled={identifying}
              title="해당 PC 화면에 확인 알림을 띄웁니다"
            >
              {identifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <MonitorCheck className="h-3 w-3" />}
              PC 확인
            </Button>
            {isEditMode && mode === "auto" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => setShowPanel((prev) => !prev)}
                >
                  <Search className="h-3 w-3" />
                  {showPanel ? "목록 닫기" : "다른 PC 선택"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-destructive"
                  onClick={onUnlink}
                >
                  <Unlink className="h-3 w-3" />
                  연결 해제
                </Button>
              </>
            )}
          </div>
        ) : (
          isEditMode && mode === "auto" && (
            <span className="text-xs text-muted-foreground">
              {allowedKinds?.length === 1 && allowedKinds[0] === 'ups'
                ? "아래 목록에서 UPS 감시 PC를 선택하면 시설명·포트·수신 파서·표시 항목이 자동으로 채워지고, 저장 시 PC에 서버 주소와 UPS 번호가 전송됩니다."
                : "아래 목록에서 PC를 선택하면 시설명·포트·프로토콜·패턴이 자동으로 채워지고, 저장 시 PC에 서버 주소가 전송됩니다."}
            </span>
          )
        )}
      </div>

      {panelOpen && (
        <ClientDiscoveryPanel
          selectedClientId={client?.id ?? null}
          currentSystemId={currentSystemId}
          allowedKinds={allowedKinds}
          onSelect={(picked, suggestedPort) => {
            onSelect(picked, suggestedPort)
            setShowPanel(false)
          }}
        />
      )}
    </div>
  )
}
