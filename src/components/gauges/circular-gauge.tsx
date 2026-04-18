'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { evaluateSensorStatus, isColdCritical, isDryCritical, isHumidCritical } from '@/lib/threshold-evaluator'
import type { ReactNode } from 'react'
import type { TrendDirection, StatusConditions } from '@/types'

interface CircularGaugeProps {
  value: number
  min?: number
  max?: number
  unit?: string
  label?: ReactNode
  warningThreshold?: number | null
  criticalThreshold?: number | null
  conditions?: StatusConditions | null
  trend?: TrendDirection | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showTrendIcon?: boolean
  responsive?: boolean
}

function getStatusFromConditions(value: number, conditions: StatusConditions): { color: string; gradientId: string } {
  const status = evaluateSensorStatus(value, conditions)
  if (status === 'critical') {
    if (isColdCritical(value, conditions)) return { color: '#3b82f6', gradientId: 'gradient-cold' }
    if (isDryCritical(value, conditions)) return { color: '#f97316', gradientId: 'gradient-dry' }
    if (isHumidCritical(value, conditions)) return { color: '#06b6d4', gradientId: 'gradient-humid' }
    return { color: '#f87171', gradientId: 'gradient-critical' }
  }
  if (status === 'warning') return { color: '#facc15', gradientId: 'gradient-warning' }
  return { color: '#4ade80', gradientId: 'gradient-normal' }
}

function getValueColor(
  value: number,
  warningThreshold?: number | null,
  criticalThreshold?: number | null
): string {
  if (criticalThreshold !== null && criticalThreshold !== undefined) {
    if (value >= criticalThreshold) return '#f87171'
  }
  if (warningThreshold !== null && warningThreshold !== undefined) {
    if (value >= warningThreshold) return '#facc15'
  }
  return '#4ade80'
}

function getGradientId(value: number, warningThreshold?: number | null, criticalThreshold?: number | null): string {
  if (criticalThreshold !== null && criticalThreshold !== undefined) {
    if (value >= criticalThreshold) return 'gradient-critical'
  }
  if (warningThreshold !== null && warningThreshold !== undefined) {
    if (value >= warningThreshold) return 'gradient-warning'
  }
  return 'gradient-normal'
}

export function CircularGauge({
  value,
  min = 0,
  max = 100,
  unit = '',
  label,
  warningThreshold,
  criticalThreshold,
  conditions,
  trend,
  size = 'md',
  showTrendIcon = true,
  responsive = false,
}: CircularGaugeProps) {
  const sizeConfig = {
    xs: { width: 56, strokeWidth: 4, fontSize: 'text-sm', labelSize: 'text-[10px]' },
    sm: { width: 80, strokeWidth: 6, fontSize: 'text-lg', labelSize: 'text-xs' },
    md: { width: 120, strokeWidth: 8, fontSize: 'text-2xl', labelSize: 'text-sm' },
    lg: { width: 160, strokeWidth: 10, fontSize: 'text-4xl', labelSize: 'text-base' },
  }

  // In responsive mode, use a dedicated viewBox coordinate system with optimized stroke ratio
  const responsiveConfig = { width: 100, strokeWidth: 10, fontSize: 'text-lg', labelSize: 'text-xs' }
  const config = responsive ? responsiveConfig : sizeConfig[size]
  const viewBoxSize = config.width
  const radius = (viewBoxSize - config.strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const normalizedValue = Math.min(Math.max((value - min) / (max - min), 0), 1)
  const strokeDashoffset = circumference * (1 - normalizedValue * 0.75)

  const { color: valueColor, gradientId } = conditions
    ? getStatusFromConditions(value, conditions)
    : { color: getValueColor(value, warningThreshold, criticalThreshold), gradientId: getGradientId(value, warningThreshold, criticalThreshold) }

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  return (
    <div className={cn("flex flex-col items-center", responsive && "w-full h-full")}>
      <div
        className={cn("relative", responsive && "w-full h-full aspect-square")}
        style={responsive ? { containerType: 'size' as const } : { width: config.width, height: config.width }}
      >
        <svg
          className="rotate-[135deg]"
          {...(responsive
            ? { viewBox: `0 0 ${viewBoxSize} ${viewBoxSize}`, width: '100%', height: '100%' }
            : { width: config.width, height: config.width }
          )}
        >
          <defs>
            <linearGradient id="gradient-normal" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#86efac" />
            </linearGradient>
            <linearGradient id="gradient-warning" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#facc15" />
              <stop offset="100%" stopColor="#fde047" />
            </linearGradient>
            <linearGradient id="gradient-critical" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f87171" />
              <stop offset="100%" stopColor="#fca5a5" />
            </linearGradient>
            <linearGradient id="gradient-cold" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#93c5fd" />
            </linearGradient>
            <linearGradient id="gradient-dry" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#fdba74" />
            </linearGradient>
            <linearGradient id="gradient-humid" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#67e8f9" />
            </linearGradient>
          </defs>

          {/* Background arc */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke="#333333"
            strokeWidth={config.strokeWidth}
            strokeDasharray={`${circumference * 0.75} ${circumference}`}
            strokeLinecap="round"
          />

          {/* Value arc */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={config.strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Center value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {responsive ? (
            <span className="tabular-nums font-bold" style={{ color: valueColor, fontSize: '26cqi' }}>
              {Math.round(value)}<span style={{ fontSize: '15cqi' }}>{unit}</span>
            </span>
          ) : (
            <>
              <span
                className={cn('tabular-nums font-bold', config.fontSize)}
                style={{ color: valueColor }}
              >
                {typeof value === 'number' ? value.toFixed(1) : value}
              </span>
              {unit && (
                <span className={cn('text-muted-foreground', config.labelSize)}>
                  {unit}
                </span>
              )}
            </>
          )}
          {responsive && label && (
            <span className="text-muted-foreground leading-tight" style={{ fontSize: '9cqi' }}>{label}</span>
          )}
          {showTrendIcon && trend && size !== 'xs' && (
            <TrendIcon
              className={cn(
                'mt-1 h-4 w-4',
                trend === 'up' && 'text-[#f87171]',
                trend === 'down' && 'text-[#4ade80]',
                trend === 'stable' && 'text-muted-foreground'
              )}
            />
          )}
        </div>
      </div>

      {label && !responsive && (
        <span className={cn('mt-2 text-muted-foreground', config.labelSize)}>
          {label}
        </span>
      )}
    </div>
  )
}
