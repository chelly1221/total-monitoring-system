'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

interface HealthCheckCardProps {
  id: string
  name: string
  status: string
  isEnabled?: boolean
  className?: string
}

function getStatusLeftBorder(status: string, isEnabled: boolean): string {
  if (!isEnabled) return 'border-l-[#525252]'

  switch (status) {
    case 'normal':
      return 'border-l-[#4ade80]'
    case 'warning':
      return 'border-l-[#facc15]'
    case 'critical':
      return 'border-l-[#f87171]'
    case 'offline':
      return 'border-l-[#facc15]'
    default:
      return 'border-l-[#a1a1aa]'
  }
}

function getStatusBgTint(status: string, isEnabled: boolean): string {
  if (!isEnabled) return '!bg-[#404040]'

  switch (status) {
    case 'normal':
      return '!bg-[#22c55e]'      // bright green
    case 'warning':
      return '!bg-[#eab308]'      // bright yellow
    case 'critical':
      return '!bg-[#ef4444]'      // bright red
    case 'offline':
      return '!bg-[#eab308]'      // yellow (warning)
    default:
      return '!bg-[#6b7280]'      // light gray
  }
}

function getStatusBadge(status: string, isEnabled: boolean): { text: string; className: string } {
  if (!isEnabled) {
    return { text: '비활성', className: 'bg-neutral-900/80 text-neutral-400' }
  }

  switch (status) {
    case 'normal':
      return { text: '정상', className: 'bg-green-900/80 text-green-100' }
    case 'warning':
      return { text: '오프라인', className: 'bg-yellow-900/80 text-yellow-100' }
    case 'critical':
      return { text: '경고', className: 'bg-red-900/80 text-red-100' }
    case 'offline':
      return { text: '오프라인', className: 'bg-yellow-900/80 text-yellow-100' }
    default:
      return { text: '오프라인', className: 'bg-gray-900/80 text-gray-100' }
  }
}

export function HealthCheckCard({
  id,
  name,
  status,
  isEnabled = true,
  className,
}: HealthCheckCardProps) {
  const isCritical = status === 'critical' && isEnabled
  const badge = getStatusBadge(status, isEnabled)

  return (
    <Link href={`/systems/${id}`}>
      <Card
        className={cn(
          'border-l-4 border-r-0 border-t-0 border-b-0 py-0 gap-0 rounded-md shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:brightness-110',
          getStatusLeftBorder(status, isEnabled),
          getStatusBgTint(status, isEnabled),
          isCritical && 'animate-pulse-border',
          !isEnabled && 'opacity-60',
          className
        )}
      >
        <CardContent className="flex items-center justify-between gap-1 py-1 px-2">
          <p className={cn(
            'truncate text-xs font-semibold drop-shadow-sm',
            !isEnabled && 'text-neutral-400',
            isEnabled && status === 'normal' && 'text-green-900',
            isEnabled && status === 'warning' && 'text-yellow-900',
            isEnabled && status === 'critical' && 'text-white',
            isEnabled && status === 'offline' && 'text-yellow-900'
          )}>
            {name}
          </p>
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0 shadow-inner border border-white/20 backdrop-blur-sm',
            badge.className
          )}>
            {badge.text}
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}
