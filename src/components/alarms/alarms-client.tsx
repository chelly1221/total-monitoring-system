'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlarmCard } from '@/components/cards/alarm-card'
import { AlarmFilterPanel } from '@/components/alarms/alarm-filter-panel'
import { AlertTriangle, AlertCircle, CheckCircle, CheckCheck } from 'lucide-react'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useRealtime } from '@/components/realtime/realtime-provider'
import type { WebSocketMessage } from '@/types'
import { toast } from 'sonner'

interface AlarmData {
  id: string
  severity: string
  message: string
  value?: string | null
  acknowledged: boolean
  acknowledgedAt: Date | null
  createdAt: Date
  resolvedAt: Date | null
  systemId: string
  system?: { id: string; name: string } | null
}

interface SystemOption {
  id: string
  name: string
  type: string
}

interface AlarmsClientProps {
  initialActiveAlarms: AlarmData[]
  initialAcknowledgedAlarms: AlarmData[]
  systems: SystemOption[]
}

export function AlarmsClient({
  initialActiveAlarms,
  initialAcknowledgedAlarms,
  systems,
}: AlarmsClientProps) {
  const [activeAlarms, setActiveAlarms] = useState<AlarmData[]>(initialActiveAlarms)
  const [acknowledgedAlarms, setAcknowledgedAlarms] = useState<AlarmData[]>(initialAcknowledgedAlarms)
  const { featureFlags } = useRealtime()

  // Filter state
  const [typeFilter, setTypeFilter] = useState<'all' | 'critical' | 'warning' | 'hot' | 'cold' | 'dry' | 'humid'>('all')

  // Reset typeFilter if current filter is a hidden temperature filter
  const temperatureFilters = ['hot', 'cold', 'dry', 'humid'] as const
  useEffect(() => {
    if (!featureFlags.temperatureEnabled && temperatureFilters.includes(typeFilter as typeof temperatureFilters[number])) {
      setTypeFilter('all')
    }
  }, [featureFlags.temperatureEnabled, typeFilter])

  // Build set of sensor system IDs to filter out when temperature is disabled
  const sensorSystemIds = useMemo(() => {
    if (featureFlags.temperatureEnabled) return null
    return new Set(systems.filter((s) => s.type === 'sensor').map((s) => s.id))
  }, [featureFlags.temperatureEnabled, systems])
  const [selectedSystems, setSelectedSystems] = useState<Set<string>>(
    () => new Set(systems.map((s) => s.id))
  )
  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(weekAgo)
  const [timeFrom, setTimeFrom] = useState('00:00')
  const [dateTo, setDateTo] = useState(today)
  const [timeTo, setTimeTo] = useState('23:59')

  // Unfiltered counts for summary stats
  const criticalCount = activeAlarms.filter((a) => a.severity === 'critical').length
  const warningCount = activeAlarms.filter((a) => a.severity === 'warning').length

  // Filter function
  const applyFilters = useCallback(
    (alarms: AlarmData[]) => {
      return alarms.filter((alarm) => {
        // Type filter
        if (typeFilter !== 'all') {
          if (typeFilter === 'critical' || typeFilter === 'warning') {
            if (alarm.severity !== typeFilter) return false
          } else {
            const keywordMap: Record<string, string> = { hot: '고온', cold: '저온', dry: '건조', humid: '다습' }
            if (!alarm.message.includes(keywordMap[typeFilter])) return false
          }
        }
        // System filter
        if (!selectedSystems.has(alarm.systemId)) return false
        // Date range filter
        const alarmTime = new Date(alarm.createdAt).getTime()
        if (dateFrom) {
          const fromTime = new Date(`${dateFrom}T${timeFrom}`).getTime()
          if (alarmTime < fromTime) return false
        }
        if (dateTo) {
          const toTime = new Date(`${dateTo}T${timeTo}`).getTime()
          if (alarmTime > toTime) return false
        }
        return true
      })
    },
    [typeFilter, selectedSystems, dateFrom, timeFrom, dateTo, timeTo]
  )

  const filteredActive = useMemo(() => {
    let result = applyFilters(activeAlarms)
    if (sensorSystemIds) result = result.filter((a) => !sensorSystemIds.has(a.systemId))
    return result
  }, [applyFilters, activeAlarms, sensorSystemIds])
  const filteredAcknowledged = useMemo(() => {
    let result = applyFilters(acknowledgedAlarms)
    if (sensorSystemIds) result = result.filter((a) => !sensorSystemIds.has(a.systemId))
    return result
  }, [applyFilters, acknowledgedAlarms, sensorSystemIds])

  // Handle WebSocket messages
  const handleMessage = useCallback((message: WebSocketMessage) => {
    const { type, data } = message

    // Handle bulk alarm acknowledgment
    if (type === 'alarm' && data.acknowledged && data.bulk && data.alarmIds) {
      const acknowledgedIds = new Set(data.alarmIds as string[])
      const alarmsToMove = activeAlarms.filter((a) => acknowledgedIds.has(a.id))
      if (alarmsToMove.length > 0) {
        setActiveAlarms((prev) => prev.filter((a) => !acknowledgedIds.has(a.id)))
        setAcknowledgedAlarms((prev) => [
          ...alarmsToMove.map((a) => ({
            ...a,
            acknowledged: true,
            acknowledgedAt: new Date(message.timestamp),
          })),
          ...prev,
        ])
      }
      return
    }

    // Handle single alarm acknowledgment (from another page)
    if (type === 'alarm' && data.acknowledged && data.alarmId) {
      const alarmId = data.alarmId as string
      const alarm = activeAlarms.find((a) => a.id === alarmId)
      if (alarm) {
        setActiveAlarms((prev) => prev.filter((a) => a.id !== alarmId))
        setAcknowledgedAlarms((prev) => [
          {
            ...alarm,
            acknowledged: true,
            acknowledgedAt: new Date(message.timestamp),
          },
          ...prev,
        ])
      }
      return
    }

    // Handle new alarm
    if (type === 'alarm' && data.alarmId && data.severity && data.message && data.systemId) {
      const newAlarm: AlarmData = {
        id: data.alarmId,
        systemId: data.systemId,
        severity: data.severity,
        message: data.message,
        value: data.alarmValue ?? null,
        acknowledged: data.acknowledged ?? false,
        acknowledgedAt: null,
        createdAt: new Date(message.timestamp),
        resolvedAt: null,
        system: { id: data.systemId, name: data.systemName || '' },
      }
      setActiveAlarms((prev) => [newAlarm, ...prev])
    } else if (type === 'alarm-resolved' && data.systemId) {
      const systemId = data.systemId as string
      setActiveAlarms((prev) => {
        const resolved = prev.filter((a) => a.systemId === systemId && a.resolvedAt === null)
        const remaining = prev.filter((a) => a.systemId !== systemId || a.resolvedAt !== null)
        if (resolved.length > 0) {
          setAcknowledgedAlarms((ack) => [
            ...resolved.map((a) => ({ ...a, resolvedAt: new Date() })),
            ...ack,
          ])
        }
        return remaining
      })
    }
  }, [activeAlarms])

  useWebSocket({
    onMessage: handleMessage,
  })

  // Sync with server data when it changes
  useEffect(() => {
    setActiveAlarms(initialActiveAlarms)
  }, [initialActiveAlarms])

  useEffect(() => {
    setAcknowledgedAlarms(initialAcknowledgedAlarms)
  }, [initialAcknowledgedAlarms])

  const handleAcknowledge = useCallback(async (alarmId: string) => {
    try {
      const response = await fetch(`/api/alarms/${alarmId}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedBy: 'operator' }),
      })

      if (!response.ok) {
        throw new Error('Failed to acknowledge alarm')
      }

      const updatedAlarm = await response.json()

      // Move alarm from active to acknowledged
      setActiveAlarms((prev) => prev.filter((a) => a.id !== alarmId))

      const acknowledgedAlarmData = activeAlarms.find((a) => a.id === alarmId)
      if (acknowledgedAlarmData) {
        setAcknowledgedAlarms((prev) => [
          {
            ...acknowledgedAlarmData,
            acknowledged: true,
            acknowledgedAt: new Date(updatedAlarm.acknowledgedAt),
          },
          ...prev,
        ])
      }

      toast.success('알람이 확인되었습니다')
    } catch (error) {
      console.error('Failed to acknowledge alarm:', error)
      toast.error('알람 확인에 실패했습니다')
    }
  }, [activeAlarms])

  const handleAcknowledgeAll = useCallback(async () => {
    if (activeAlarms.length === 0) return

    try {
      const response = await fetch('/api/alarms/acknowledge-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgedBy: 'operator' }),
      })

      if (!response.ok) {
        throw new Error('Failed to acknowledge all alarms')
      }

      const { count } = await response.json()

      // Move all active alarms to acknowledged
      const now = new Date()
      setAcknowledgedAlarms((prev) => [
        ...activeAlarms.map((a) => ({
          ...a,
          acknowledged: true,
          acknowledgedAt: now,
        })),
        ...prev,
      ])
      setActiveAlarms([])

      toast.success(`${count}개 알람이 일괄 확인되었습니다`)
    } catch (error) {
      console.error('Failed to acknowledge all alarms:', error)
      toast.error('일괄 확인에 실패했습니다')
    }
  }, [activeAlarms])

  return (
    <div className="flex h-full gap-4">
      {/* Left column: alarm list (1/3) */}
      <div className="w-1/3 flex flex-col min-h-0 space-y-3">
        {/* Summary Stats */}
        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-7 w-7 text-[#f87171]" />
            <div>
              <p className="text-xs text-muted-foreground">경고</p>
              <p className="text-xl font-bold text-[#f87171]">{criticalCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-7 w-7 text-[#facc15]" />
            <div>
              <p className="text-xs text-muted-foreground">오프라인</p>
              <p className="text-xl font-bold text-[#facc15]">{warningCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-7 w-7 text-[#4ade80]" />
            <div>
              <p className="text-xs text-muted-foreground">확인됨</p>
              <p className="text-xl font-bold text-[#4ade80]">{acknowledgedAlarms.length}</p>
            </div>
          </div>
        </div>

        {/* Merged alarm list */}
        <Card className="flex-1 min-h-0 flex flex-col py-0">
          <CardContent className="flex-1 min-h-0 p-0 overflow-auto">
            {filteredActive.length === 0 && filteredAcknowledged.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                표시할 알람 없음
              </div>
            ) : (
              <div>
                {/* Active alarms section */}
                {filteredActive.length > 0 && (
                  <>
                    <div className="sticky top-0 z-10 bg-card border-b px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                      활성 알람
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        {filteredActive.length}
                      </Badge>
                    </div>
                    {filteredActive.map((alarm) => (
                      <AlarmCard
                        key={alarm.id}
                        alarm={alarm}
                        onAcknowledge={handleAcknowledge}
                      />
                    ))}
                  </>
                )}

                {/* Acknowledged alarms section */}
                {filteredAcknowledged.length > 0 && (
                  <>
                    <div className="sticky top-0 z-10 bg-card border-b px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                      알람 이력
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {filteredAcknowledged.length}
                      </Badge>
                      {activeAlarms.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAcknowledgeAll}
                          className="gap-1.5 ml-auto h-5 text-[10px] px-2"
                        >
                          <CheckCheck className="h-3 w-3" />
                          일괄 확인
                        </Button>
                      )}
                    </div>
                    {filteredAcknowledged.map((alarm) => (
                      <AlarmCard key={alarm.id} alarm={alarm} showAcknowledgedLabel={false} />
                    ))}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right column: filter panel (2/3) */}
      <div className="w-2/3 min-h-0">
        <AlarmFilterPanel
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          systems={systems}
          selectedSystems={selectedSystems}
          onSelectedSystemsChange={setSelectedSystems}
          dateFrom={dateFrom}
          timeFrom={timeFrom}
          dateTo={dateTo}
          timeTo={timeTo}
          onDateFromChange={setDateFrom}
          onTimeFromChange={setTimeFrom}
          onDateToChange={setDateTo}
          onTimeToChange={setTimeTo}
          temperatureEnabled={featureFlags.temperatureEnabled}
        />
      </div>
    </div>
  )
}
