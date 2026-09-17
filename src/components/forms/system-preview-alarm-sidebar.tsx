import { AlarmCard } from "@/components/cards/alarm-card"
import { SystemDataPreview } from "@/components/forms/system-data-preview"
import { PingEventLog } from "@/components/forms/ping-event-log"

interface AlarmData {
  id: string
  severity: string
  message: string
  value?: string | null
  createdAt: string
  acknowledged: boolean
  acknowledgedAt: string | null
  system: { id: string; name: string }
}

interface SystemPreviewAlarmSidebarProps {
  port: string
  wsConnected: boolean
  previewMessages: string[]
  alarms: AlarmData[]
  onAcknowledge: (alarmId: string) => void
  /** Facility id when a 네트워크 ping 감시 client is bound: shows its 장애 내역. */
  pingSystemId?: string | null
}

export function SystemPreviewAlarmSidebar({
  port,
  wsConnected,
  previewMessages,
  alarms,
  onAcknowledge,
  pingSystemId,
}: SystemPreviewAlarmSidebarProps) {
  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-hidden">
      {/* 상단: 데이터 미리보기 */}
      <div className="flex-1 flex flex-col overflow-hidden border rounded p-1.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
          데이터 미리보기
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <SystemDataPreview
            port={port}
            connected={wsConnected}
            messages={previewMessages}
            className="flex-1 min-h-0"
          />
        </div>
      </div>
      {/* 중간: ping 감시 대상별 장애·복구 내역 (ping 클라이언트 연결 시) */}
      {pingSystemId && <PingEventLog systemId={pingSystemId} />}
      {/* 하단: 알람 로그 */}
      <div className="flex-1 flex flex-col overflow-hidden border rounded p-1.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
          알람 로그
        </div>
        <div className="flex-1 overflow-y-auto">
          {alarms.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
              알람 기록 없음
            </div>
          ) : (
            <div className="space-y-0.5">
              {alarms.map((alarm) => (
                <AlarmCard
                  key={alarm.id}
                  alarm={alarm as never}
                  onAcknowledge={onAcknowledge}
                  showSystemName={false}
                  compact={true}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
