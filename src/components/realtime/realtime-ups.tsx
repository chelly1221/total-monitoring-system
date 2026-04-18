'use client'

import { useRealtime } from './realtime-provider'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LineChart } from '@/components/charts/line-chart'
import { PlusCircle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { MetricsConfig, DisplayItem, SystemStatus } from '@/types'
import { insertGapMarkers, forwardFill } from '@/lib/chart-utils'

const UPS_COLORS = ['#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6', '#84cc16']
const DEFAULT_CHART_METRIC_NAMES = ['입력전압', '입력전류', '출력전압', '출력전류', '주파수', '배터리잔량']

// Default bar ranges per itemType [min, max]
const BAR_RANGES: Record<string, [number, number]> = {
  inputVoltage: [180, 240],
  outputVoltage: [180, 240],
  inputCurrent: [0, 100],
  outputCurrent: [0, 100],
  inputFrequency: [55, 65],
  outputFrequency: [55, 65],
  load: [0, 100],
  batteryVoltage: [0, 60],
  batteryRemaining: [0, 100],
  temperature: [0, 60],
}

interface MetricHistoryItem {
  id: string
  name: string
  unit: string
  systemId: string
  system: { name: string }
  history: { value: number; recordedAt: string }[]
}

interface ChartDataPoint {
  time: string
  ts: number
  [key: string]: string | number | null
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function downsample(data: ChartDataPoint[], maxPoints: number): ChartDataPoint[] {
  if (data.length <= maxPoints) return data
  const step = Math.ceil(data.length / maxPoints)
  const result: ChartDataPoint[] = []
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i])
  }
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1])
  }
  return result
}

// Metric status helpers
function getMetricStatus(value: number, item: DisplayItem, textValue?: string | null): 'normal' | 'warning' | 'critical' {
  if (item.alarmEnabled === false) return 'normal'
  // Evaluate conditions-based thresholds first
  if (item.conditions) {
    for (const cond of item.conditions.critical || []) {
      if (cond.operator === 'gte' && value >= cond.value1) return 'critical'
      if (cond.operator === 'lte' && value <= cond.value1) return 'critical'
      if (cond.operator === 'eq') {
        const compareVal = textValue ?? String(value)
        const target = cond.stringValue ?? String(cond.value1)
        if (compareVal === target) return 'critical'
      }
      if (cond.operator === 'neq') {
        const compareVal = textValue ?? String(value)
        const target = cond.stringValue ?? String(cond.value1)
        if (compareVal !== target) return 'critical'
      }
    }
    return 'normal'
  }
  // Legacy fallback
  if (item.critical != null && value >= item.critical) return 'critical'
  if (item.warning != null && value <= item.warning) return 'critical'
  return 'normal'
}

function getStatusDotColor(status: 'normal' | 'warning' | 'critical'): string {
  switch (status) {
    case 'critical': return 'bg-[#ef4444]'
    case 'warning': return 'bg-[#eab308]'
    default: return 'bg-[#22c55e]'
  }
}

function getStatusTextColor(status: 'normal' | 'warning' | 'critical'): string {
  switch (status) {
    case 'critical': return 'text-[#ef4444]'
    case 'warning': return 'text-[#eab308]'
    default: return 'text-[#22c55e]'
  }
}

function getSystemStatusColor(status: string): string {
  switch (status) {
    case 'normal': return 'bg-[#22c55e]'
    case 'warning': return 'bg-[#eab308]'
    case 'critical': return 'bg-[#ef4444]'
    default: return 'bg-[#71717a]'
  }
}

function getSystemStatusLabel(status: string): string {
  switch (status) {
    case 'normal': return '정상'
    case 'warning': return '경고'
    case 'critical': return '경고'
    case 'offline': return '오프라인'
    default: return '오프라인'
  }
}

interface RealtimeUpsPanelProps {
  upsSystemIds: string[]
}

// Per-metric chart data cache
interface MetricChartCache {
  data: ChartDataPoint[]
  lines: { dataKey: string; name: string; color: string }[]
}

// Module-level cache
const chartCache: {
  charts: Map<string, MetricChartCache>
  historyLoaded: boolean
} = {
  charts: new Map(),
  historyLoaded: false,
}

export function RealtimeUpsPanel({ upsSystemIds }: RealtimeUpsPanelProps) {
  const { systems, lastUpdate } = useRealtime()

  const [chartsMap, setChartsMap] = useState<Map<string, MetricChartCache>>(() => chartCache.charts)
  const [historyLoaded, setHistoryLoaded] = useState(() => chartCache.historyLoaded)
  const lastAppendRef = useRef<number>(0)

  // Get UPS systems from realtime data
  const upsSystems = systems.filter((s) => upsSystemIds.includes(s.id))

  // Parse configs to get display items per system
  const systemConfigs = useMemo(() => {
    const configs = new Map<string, MetricsConfig>()
    for (const sys of upsSystems) {
      if (sys.config) {
        try {
          const parsed = JSON.parse(sys.config as string) as MetricsConfig
          configs.set(sys.id, parsed)
        } catch { /* ignore */ }
      }
    }
    return configs
  }, [upsSystems])

  // Build a stable system → color index map (same order as card rendering)
  const systemColorMap = useMemo(() => {
    const map = new Map<string, number>()
    const mainSystems = upsSystems.filter(s => s.name !== '경항공기 통신실')
    const subSystem = upsSystems.find(s => s.name === '경항공기 통신실')
    mainSystems.sort((a, b) => a.name.localeCompare(b.name))
    const ordered = [...mainSystems, ...(subSystem ? [subSystem] : [])]
    ordered.forEach((sys, i) => map.set(sys.id, i))
    return map
  }, [upsSystems])

  // Track systems ref for async callbacks
  const upsSystemsRef = useRef(upsSystems)
  upsSystemsRef.current = upsSystems
  const systemConfigsRef = useRef(systemConfigs)
  systemConfigsRef.current = systemConfigs
  const systemColorMapRef = useRef(systemColorMap)
  systemColorMapRef.current = systemColorMap

  // Sync state changes back to module-level cache
  useEffect(() => {
    chartCache.charts = chartsMap
    chartCache.historyLoaded = historyLoaded
  }, [chartsMap, historyLoaded])

  // Resolve chart group for a metric: lookup from configs, fallback to name matching
  const resolveChartGroup = useCallback((metricName: string, systemId: string): string | null => {
    const config = systemConfigsRef.current.get(systemId)
    if (config) {
      const item = config.displayItems.find(d => d.name === metricName)
      if (item) {
        // Explicit chartGroup set
        if (item.chartGroup !== undefined) return item.chartGroup
        // Backward compat: infer from name if chartEnabled not explicitly false
        if (item.chartEnabled !== false && DEFAULT_CHART_METRIC_NAMES.includes(metricName)) return metricName
        return null
      }
    }
    // No config found: fallback to name matching
    if (DEFAULT_CHART_METRIC_NAMES.includes(metricName)) return metricName
    return null
  }, [])

  // Build chart data from history API
  const buildChartData = useCallback((metrics: MetricHistoryItem[]) => {
    const newChartsMap = new Map<string, MetricChartCache>()

    // Group metrics by chart group (resolved from config)
    const metricsByGroup = new Map<string, MetricHistoryItem[]>()
    for (const m of metrics) {
      const group = resolveChartGroup(m.name, m.systemId)
      if (!group) continue
      const arr = metricsByGroup.get(group) ?? []
      arr.push(m)
      metricsByGroup.set(group, arr)
    }

    for (const [groupName, metricGroup] of metricsByGroup) {
      const timeMap = new Map<string, ChartDataPoint>()
      const lines: { dataKey: string; name: string; color: string }[] = []

      metricGroup.forEach((m, i) => {
        // Unique key: systemName:metricName (avoids R/S/T overwriting each other)
        const key = `${m.system.name}:${m.name}`
        // Display name: strip chartGroup prefix from metric name, prepend system name
        const suffix = m.name.startsWith(groupName) ? m.name.slice(groupName.length) : m.name
        const displayName = suffix ? `${m.system.name} ${suffix}` : m.system.name
        if (!lines.find(l => l.dataKey === key)) {
            const colorIdx = systemColorMapRef.current.get(m.systemId) ?? i
          lines.push({ dataKey: key, name: displayName, color: UPS_COLORS[colorIdx % UPS_COLORS.length] })
        }
        for (const h of m.history) {
          const t = formatTime(new Date(h.recordedAt))
          const existing = timeMap.get(h.recordedAt) ?? { time: t, ts: new Date(h.recordedAt).getTime() }
          existing[key] = h.value
          timeMap.set(h.recordedAt, existing)
        }
      })

      const sorted = Array.from(timeMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v)

      newChartsMap.set(groupName, {
        data: downsample(sorted, 2000),
        lines,
      })
    }

    setChartsMap(newChartsMap)
  }, [resolveChartGroup])

  // Fetch history on mount
  useEffect(() => {
    if (chartCache.historyLoaded && chartCache.charts.size > 0) return

    async function fetchHistory() {
      try {
        const res = await fetch('/api/metrics/history?type=ups&hours=24')
        if (!res.ok) return
        const data: MetricHistoryItem[] = await res.json()
        buildChartData(data)
        setHistoryLoaded(true)
      } catch (e) {
        console.error('[ups] Failed to fetch history:', e)
      }
    }
    fetchHistory()
  }, [buildChartData])

  // Append new data points from realtime updates (throttled to 10s)
  useEffect(() => {
    if (!historyLoaded || !lastUpdate) return

    const now = Date.now()
    if (now - lastAppendRef.current < 10000) return
    lastAppendRef.current = now

    const timeStr = formatTime(new Date())
    const cutoff = now - 24 * 60 * 60 * 1000

    setChartsMap((prev) => {
      const next = new Map(prev)

      // Group current metrics by chart group (keyed by systemName:metricName)
      const metricsByGroup = new Map<string, { key: string; value: number }[]>()
      for (const sys of upsSystems) {
        for (const m of sys.metrics ?? []) {
          const group = resolveChartGroup(m.name, sys.id)
          if (!group) continue
          const arr = metricsByGroup.get(group) ?? []
          arr.push({ key: `${sys.name}:${m.name}`, value: m.value })
          metricsByGroup.set(group, arr)
        }
      }

      for (const [groupName, values] of metricsByGroup) {
        const existing = next.get(groupName)
        if (!existing) continue

        const point: ChartDataPoint = { time: timeStr, ts: now }
        for (const { key, value } of values) {
          point[key] = value
        }

        const updated = [...existing.data, point]
        const firstValid = updated.findIndex(p => p.ts >= cutoff)
        next.set(groupName, {
          ...existing,
          data: firstValid > 0 ? updated.slice(firstValid) : updated,
        })
      }

      return next
    })
  }, [lastUpdate, historyLoaded, upsSystems, resolveChartGroup])

  // Derive chart group names from configs, with fallback to defaults
  const chartGroupNames = useMemo(() => {
    const groups = new Set<string>()
    for (const config of systemConfigs.values()) {
      for (const item of config.displayItems) {
        if (item.chartGroup) {
          groups.add(item.chartGroup)
        } else if (item.chartGroup === undefined && item.chartEnabled !== false && DEFAULT_CHART_METRIC_NAMES.includes(item.name)) {
          // Backward compat: infer from name
          groups.add(item.name)
        }
      }
    }
    // If no configs found, use defaults
    if (groups.size === 0) return DEFAULT_CHART_METRIC_NAMES
    // Sort by DEFAULT_CHART_METRIC_NAMES order
    return DEFAULT_CHART_METRIC_NAMES.filter(n => groups.has(n))
  }, [systemConfigs])

  // Prepare display data for charts (downsample + forward-fill + gap markers)
  const displayCharts = useMemo(() => {
    const result = new Map<string, { data: ChartDataPoint[]; lines: { dataKey: string; name: string; color: string }[] }>()
    for (const groupName of chartGroupNames) {
      const cache = chartsMap.get(groupName)
      if (!cache || cache.data.length === 0) continue
      const ds = downsample(cache.data, 2000)
      forwardFill(ds, cache.lines.map(l => l.dataKey))
      result.set(groupName, {
        data: insertGapMarkers(ds, cache.lines.map(l => l.dataKey)),
        lines: cache.lines,
      })
    }
    return result
  }, [chartsMap, chartGroupNames])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderSystemCard(sys: any, config: MetricsConfig | undefined, status: SystemStatus, displayItems: DisplayItem[], colorIndex: number) {
    return (
      <Card className="py-0 gap-0 transition-colors hover:border-primary/50 cursor-pointer">
        <CardHeader className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: UPS_COLORS[colorIndex % UPS_COLORS.length] }} />
            <CardTitle className="text-sm font-medium">{sys.name}</CardTitle>
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
              status === 'normal' ? 'bg-[#22c55e]/20 text-[#22c55e]' :
              status === 'warning' ? 'bg-[#eab308]/20 text-[#eab308]' :
              status === 'critical' ? 'bg-[#ef4444]/20 text-[#ef4444]' :
              'bg-[#71717a]/20 text-[#71717a]'
            }`}>
              {getSystemStatusLabel(status)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-2 pt-0">
          {(sys.metrics ?? []).length === 0 ? (
            <div className="flex h-8 items-center justify-center text-xs text-muted-foreground">
              메트릭 없음
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="py-0.5 px-2 w-0 whitespace-nowrap"></th>
                  <th className="py-0.5 px-2"></th>
                  <th className="py-0.5 px-2 w-0"></th>
                  <th className="py-0.5 px-2 w-0"></th>
                </tr>
              </thead>
              <tbody>
                {(sys.metrics ?? []).map((metric: { id: string; name: string; value: number; textValue?: string | null; unit: string }) => {
                  const displayItem = displayItems.find(d => d.name === metric.name)
                  const metricStatus = displayItem
                    ? getMetricStatus(metric.value, displayItem, metric.textValue)
                    : 'normal'
                  const displayValue = metric.textValue ?? metric.value

                  const isNumeric = metric.textValue == null
                  let barMin: number | null = null
                  let barMax: number | null = null
                  if (isNumeric && displayItem) {
                    if (metric.unit === '%') {
                      barMin = 0
                      barMax = 100
                    } else if (displayItem.conditions?.critical?.length) {
                      // Extract lte (하한치) and gte (상한치) from critical conditions
                      for (const cond of displayItem.conditions.critical) {
                        if (cond.operator === 'lte') barMin = cond.value1
                        if (cond.operator === 'gte') barMax = cond.value1
                      }
                    } else if (displayItem.warning != null && displayItem.critical != null) {
                      barMin = displayItem.warning
                      barMax = displayItem.critical
                    }
                    // Fallback to BAR_RANGES if still missing
                    if ((barMin == null || barMax == null) && displayItem.itemType && BAR_RANGES[displayItem.itemType]) {
                      [barMin, barMax] = BAR_RANGES[displayItem.itemType]
                    }
                  }
                  const hasRange = barMin != null && barMax != null
                  let barPercent = 0
                  if (hasRange) {
                    barPercent = barMax !== barMin ? Math.max(0, Math.min(100, ((metric.value - barMin!) / (barMax! - barMin!)) * 100)) : 50
                  }

                  return (
                    <tr key={metric.id} className={`border-b border-border/30 last:border-0 ${metricStatus === 'critical' ? 'bg-[#ef4444]/20' : ''}`}>
                      <td className="py-0.5 px-2 text-muted-foreground whitespace-nowrap">{metric.name}</td>
                      <td className="py-0.5 px-1">
                        {hasRange && (
                          <div className="h-2 w-full rounded-full bg-zinc-600 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${metricStatus === 'critical' ? 'bg-[#ef4444]' : metricStatus === 'warning' ? 'bg-[#eab308]' : 'bg-[#22c55e]'}`}
                              style={{ width: `${barPercent}%`, transition: 'width 0.5s ease' }}
                            />
                          </div>
                        )}
                      </td>
                      <td className={`py-0.5 pl-2 pr-[2px] text-right font-mono font-medium whitespace-nowrap ${getStatusTextColor(metricStatus)}`}>
                        {displayValue}
                      </td>
                      <td className="py-0.5 pl-[2px] pr-2 text-right text-muted-foreground whitespace-nowrap">{metric.unit}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-3">
        <h1 className="text-2xl font-bold">UPS</h1>
        <Button
          asChild
          size="icon"
          variant="ghost"
          className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md text-white hover:text-white"
        >
          <Link href="/ups/new">
            <PlusCircle className="h-5 w-5" />
          </Link>
        </Button>
      </div>

      {upsSystems.length === 0 ? (
        <Card>
          <CardContent className="flex h-40 items-center justify-center">
            <p className="text-muted-foreground">등록된 UPS 시스템이 없습니다.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid flex-1 gap-2 overflow-hidden grid-cols-2">
          {/* Left: Two columns — col1: UPS#1, col2: UPS#2 + 경항공기 */}
          <div className="grid gap-2 overflow-y-auto grid-cols-2">
            {(() => {
              const mainSystems = upsSystems.filter(s => s.name !== '경항공기 통신실')
              const subSystem = upsSystems.find(s => s.name === '경항공기 통신실')
              mainSystems.sort((a, b) => a.name.localeCompare(b.name))
              const col1Systems = mainSystems.slice(0, 1)
              const col2Systems = [...mainSystems.slice(1), ...(subSystem ? [subSystem] : [])]
              return (
                <>
                  <div className="flex flex-col gap-2">
                    {col1Systems.map((sys) => {
                      const config = systemConfigs.get(sys.id)
                      const status = sys.status as SystemStatus
                      const displayItems = config?.displayItems ?? []
                      return (
                        <Link key={sys.id} href={`/ups/${sys.id}`} className="block">
                          {renderSystemCard(sys, config, status, displayItems, systemColorMap.get(sys.id) ?? 0)}
                        </Link>
                      )
                    })}
                  </div>
                  <div className="flex flex-col gap-2">
                    {col2Systems.map((sys) => {
                      const config = systemConfigs.get(sys.id)
                      const status = sys.status as SystemStatus
                      const displayItems = config?.displayItems ?? []
                      return (
                        <Link key={sys.id} href={`/ups/${sys.id}`} className="block">
                          {renderSystemCard(sys, config, status, displayItems, systemColorMap.get(sys.id) ?? 0)}
                        </Link>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </div>

          {/* Right: Charts 2x3 grid */}
          <div className="grid grid-cols-2 grid-rows-3 gap-2 min-h-0">
            {chartGroupNames.map((metricName) => {
              const chart = displayCharts.get(metricName)
              const yDomain: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'] | undefined =
                metricName === '주파수' ? [59.5, 60.5] : undefined
              return (
                <Card key={metricName} className="flex flex-col overflow-hidden py-0 gap-0 min-h-0">
                  <CardHeader className="flex-none px-2 py-1.5">
                    <CardTitle className="text-sm">{metricName}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 px-1 pb-1 pt-0 min-h-0">
                    {chart && chart.data.length > 0 ? (
                      <LineChart
                        data={chart.data}
                        lines={chart.lines}
                        height="100%"
                        showLegend={false}
                        xDataKey="ts"
                        xAxisType="number"
                        connectNulls={false}
                        yDomain={yDomain}
                        xAxisTickFormatter={(ts) => {
                          const d = new Date(ts)
                          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                        {historyLoaded ? '이력 데이터 수집 중...' : '데이터 로딩 중...'}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
