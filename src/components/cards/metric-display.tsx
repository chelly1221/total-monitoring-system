'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TrendDirection } from '@/types'

interface MetricDisplayProps {
  name: string
  value: number
  unit?: string
  trend?: TrendDirection | null
  warningThreshold?: number | null
  criticalThreshold?: number | null
  className?: string
}

function getValueColor(
  value: number,
  warningThreshold?: number | null,
  criticalThreshold?: number | null
): string {
  if (criticalThreshold !== null && criticalThreshold !== undefined) {
    if (value >= criticalThreshold) return 'text-[#f87171]'
  }
  if (warningThreshold !== null && warningThreshold !== undefined) {
    if (value >= warningThreshold) return 'text-[#facc15]'
  }
  return 'text-[#4ade80]'
}

export function MetricDisplay({
  name,
  value,
  unit = '',
  trend,
  warningThreshold,
  criticalThreshold,
  className,
}: MetricDisplayProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const valueColor = getValueColor(value, warningThreshold, criticalThreshold)

  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-xs text-muted-foreground">{name}</span>
      <div className="flex items-baseline gap-1">
        <span className={cn('tabular-nums text-2xl font-bold', valueColor)}>
          {typeof value === 'number' ? value.toFixed(1) : value}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        {trend && (
          <TrendIcon
            className={cn(
              'ml-1 h-4 w-4',
              trend === 'up' && 'text-[#f87171]',
              trend === 'down' && 'text-[#4ade80]',
              trend === 'stable' && 'text-muted-foreground'
            )}
          />
        )}
      </div>
    </div>
  )
}
