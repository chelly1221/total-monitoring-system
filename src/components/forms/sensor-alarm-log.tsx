import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlarmCard } from "@/components/cards/alarm-card"

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

interface SensorAlarmLogProps {
  alarms: AlarmData[]
  onAcknowledge: (alarmId: string) => void
}

export function SensorAlarmLog({ alarms, onAcknowledge }: SensorAlarmLogProps) {
  return (
    <Card className="flex-1 flex flex-col overflow-hidden p-0">
      <CardHeader className="shrink-0 py-2">
        <CardTitle className="text-sm">알람 로그</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto px-3 pb-3">
        {alarms.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            알람 기록 없음
          </div>
        ) : (
          <div className="space-y-1">
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
      </CardContent>
    </Card>
  )
}
