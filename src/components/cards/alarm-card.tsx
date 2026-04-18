'use client'

import { AlertTriangle, AlertCircle, Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface AlarmData {
  id: string
  severity: string
  message: string
  value?: string | null
  acknowledged: boolean
  createdAt: Date
  system?: { name: string } | null
}

interface AlarmCardProps {
  alarm: AlarmData
  onAcknowledge?: (id: string) => void
  className?: string
  compact?: boolean
  showAcknowledgedLabel?: boolean
  showSystemName?: boolean
}

type AlarmTheme = { label: string; color: string; bg: string; border: string }

/** Extract item name from UPS-style alarm messages like "시스템명 입력전압 임계치 초과 상태" */
function getItemName(alarm: AlarmData): string | null {
  if (!alarm.message.includes('임계치 초과')) return null
  const systemName = alarm.system?.name || ''
  const afterSystem = systemName ? alarm.message.replace(systemName + ' ', '') : alarm.message
  const itemName = afterSystem.replace(' 임계치 초과 상태', '')
  return itemName !== afterSystem && itemName.length > 0 ? itemName : null
}

function getAlarmTheme(alarm: AlarmData): AlarmTheme {
  if (alarm.message.includes('고온')) return { label: '고온', color: 'text-red-500', bg: 'bg-red-500', border: 'border-red-500' }
  if (alarm.message.includes('저온')) return { label: '저온', color: 'text-blue-500', bg: 'bg-blue-500', border: 'border-blue-500' }
  if (alarm.message.includes('건조')) return { label: '건조', color: 'text-orange-500', bg: 'bg-orange-500', border: 'border-orange-500' }
  if (alarm.message.includes('다습')) return { label: '다습', color: 'text-cyan-500', bg: 'bg-cyan-500', border: 'border-cyan-500' }
  if (alarm.severity === 'critical') return { label: '심각', color: 'text-[#f87171]', bg: 'bg-[#f87171]', border: 'border-[#f87171]' }
  return { label: '오프라인', color: 'text-[#facc15]', bg: 'bg-[#facc15]', border: 'border-[#facc15]' }
}

function formatTime(date: Date): string {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${year}.${month}.${day} ${hour}:${minute}`
}

export function AlarmCard({ alarm, onAcknowledge, className, compact = false, showAcknowledgedLabel = true, showSystemName = true }: AlarmCardProps) {
  const isCritical = alarm.severity === 'critical'
  const theme = getAlarmTheme(alarm)
  const Icon = isCritical ? AlertCircle : AlertTriangle

  const itemName = getItemName(alarm)

  if (compact) {
    return (
      <Card
        className={cn(
          'flex flex-row items-center gap-2 rounded border px-2 py-0.5 text-xs shadow-none',
          !alarm.acknowledged && theme.border,
          !alarm.acknowledged && `${theme.bg}/10`,
          alarm.acknowledged && 'opacity-60 border-border',
          className
        )}
      >
        <Icon className={cn('h-3 w-3 shrink-0', theme.color)} />
        <span className={cn('font-medium shrink-0', theme.color)}>
          {theme.label}
        </span>
        {showSystemName && <span className="text-white shrink-0">{alarm.system?.name || '알 수 없음'}</span>}
        {itemName && <span className="text-muted-foreground shrink-0">{itemName}</span>}
        {alarm.value && <span className="text-muted-foreground shrink-0">({alarm.value})</span>}
        <span className="text-muted-foreground shrink-0 ml-auto">{formatTime(alarm.createdAt)}</span>
      </Card>
    )
  }

  // In acknowledged alarms tab (showAcknowledgedLabel=false), don't dim the card
  const shouldDim = alarm.acknowledged && showAcknowledgedLabel

  return (
    <Card
      className={cn(
        'flex flex-row items-center justify-between rounded-none border px-2 py-1 text-xs shadow-none gap-0',
        !alarm.acknowledged && showAcknowledgedLabel && theme.border,
        !alarm.acknowledged && showAcknowledgedLabel && `${theme.bg}/5`,
        isCritical && !alarm.acknowledged && showAcknowledgedLabel && 'animate-pulse-border',
        shouldDim && 'opacity-60 border-border bg-card',
        (!showAcknowledgedLabel || (alarm.acknowledged && !shouldDim)) && 'border-border bg-card',
        className
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', theme.color)} />
        <span className={cn('font-medium shrink-0', theme.color)}>
          {theme.label}
        </span>
        {showSystemName && <span className="text-white shrink-0">{alarm.system?.name || '알 수 없음'}</span>}
        {itemName && <span className="text-muted-foreground shrink-0">{itemName}</span>}
        {alarm.value && <span className="text-muted-foreground shrink-0">({alarm.value})</span>}
        <span className="text-muted-foreground/70 shrink-0 ml-auto">
          {formatTime(alarm.createdAt)}
        </span>
      </div>

      {!alarm.acknowledged && onAcknowledge && (
        <button
          onClick={() => onAcknowledge(alarm.id)}
          className="shrink-0 ml-2 flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent cursor-pointer"
        >
          <Check className="h-3 w-3" />
          확인
        </button>
      )}

      {alarm.acknowledged && showAcknowledgedLabel && (
        <span className="shrink-0 ml-2 text-muted-foreground/70">확인됨</span>
      )}
    </Card>
  )
}
