'use client'

import { useRealtime } from './realtime-provider'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CircularGauge } from '@/components/gauges/circular-gauge'
import { LineChart } from '@/components/charts/line-chart'
import { Thermometer, Droplets } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, PlusCircle } from 'lucide-react'
import type { TrendDirection, MetricsConfig, StatusConditions } from '@/types'
import { insertGapMarkers, forwardFill } from '@/lib/chart-utils'

// Unified sensor colors — each sensor gets one color shared across card dot, temp line, and humidity line
const SENSOR_COLORS = ['#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6', '#84cc16']

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

function getGridClasses(count: number): string {
  if (count <= 4) return 'grid-cols-1 grid-rows-4'
  if (count <= 8) return 'grid-cols-4 grid-rows-2'
  return 'grid-cols-4 grid-rows-4'
}

type LayoutOverride = '4' | '8' | '16'

interface RealtimeTemperaturePanelProps {
  sensorSystemIds: string[]
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
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1])
  }
  return result
}

// Module-level cache: persists across client-side navigations
const chartCache = {
  tempChartData: [] as ChartDataPoint[],
  humidityChartData: [] as ChartDataPoint[],
  tempLines: [] as { dataKey: string; name: string; color: string }[],
  humidityLines: [] as { dataKey: string; name: string; color: string }[],
  historyLoaded: false,
}

export function RealtimeTemperaturePanel({ sensorSystemIds }: RealtimeTemperaturePanelProps) {
  const { systems, lastUpdate } = useRealtime()
  const router = useRouter()

  const [tempChartData, setTempChartData] = useState<ChartDataPoint[]>(() => chartCache.tempChartData)
  const [humidityChartData, setHumidityChartData] = useState<ChartDataPoint[]>(() => chartCache.humidityChartData)
  const [tempLines, setTempLines] = useState<{ dataKey: string; name: string; color: string }[]>(() => chartCache.tempLines)
  const [humidityLines, setHumidityLines] = useState<{ dataKey: string; name: string; color: string }[]>(() => chartCache.humidityLines)
  const [historyLoaded, setHistoryLoaded] = useState(() => chartCache.historyLoaded)
  const lastAppendRef = useRef<number>(0)

  // Get sensor systems from realtime data
  const sensorSystems = systems.filter((s) => sensorSystemIds.includes(s.id))

  // Layout override for grid configurations
  const [layoutOverride, setLayoutOverride] = useState<LayoutOverride>('4')

  const displaySystems = useMemo(() => {
    return sensorSystems.slice(0, parseInt(layoutOverride, 10))
  }, [sensorSystems, layoutOverride])

  const effectiveCount = parseInt(layoutOverride, 10)
  const gridClasses = getGridClasses(effectiveCount)

  // Track sensorSystems in ref so fetchHistory callback can access current values
  const sensorSystemsRef = useRef(sensorSystems)
  sensorSystemsRef.current = sensorSystems

  // Sync state changes back to module-level cache
  useEffect(() => {
    chartCache.tempChartData = tempChartData
    chartCache.humidityChartData = humidityChartData
    chartCache.tempLines = tempLines
    chartCache.humidityLines = humidityLines
    chartCache.historyLoaded = historyLoaded
  }, [tempChartData, humidityChartData, tempLines, humidityLines, historyLoaded])

  // Seed chart data from current realtime values when history is empty
  const seedFromRealtimeData = useCallback((currentSystems: typeof sensorSystems) => {
    const now = Date.now()
    const timeStr = formatTime(new Date(now))
    const tempPoint: ChartDataPoint = { time: timeStr, ts: now }
    const humidPoint: ChartDataPoint = { time: timeStr, ts: now }
    const tLines: { dataKey: string; name: string; color: string }[] = []
    const hLines: { dataKey: string; name: string; color: string }[] = []

    currentSystems.forEach((sys, i) => {
      const temp = sys.metrics?.find((m) => m.name === '온도')
      const humid = sys.metrics?.find((m) => m.name === '습도')
      if (temp) {
        tLines.push({ dataKey: sys.name, name: sys.name, color: SENSOR_COLORS[i % SENSOR_COLORS.length] })
        tempPoint[sys.name] = temp.value
      }
      if (humid) {
        hLines.push({ dataKey: sys.name, name: sys.name, color: SENSOR_COLORS[i % SENSOR_COLORS.length] })
        humidPoint[sys.name] = humid.value
      }
    })

    if (tLines.length > 0) { setTempLines(tLines); setTempChartData([tempPoint]) }
    if (hLines.length > 0) { setHumidityLines(hLines); setHumidityChartData([humidPoint]) }
  }, [])

  // Build history data from API
  const buildChartData = useCallback((metrics: MetricHistoryItem[]) => {
    // Build name→color map from current system order (matches card dot order)
    const currentSystems = sensorSystemsRef.current
    const colorMap = new Map<string, string>()
    currentSystems.forEach((sys, i) => {
      colorMap.set(sys.name, SENSOR_COLORS[i % SENSOR_COLORS.length])
    })

    const tempMetrics = metrics.filter((m) => m.name === '온도')
    const humidMetrics = metrics.filter((m) => m.name === '습도')

    // Build temp chart
    const tempTimeMap = new Map<string, ChartDataPoint>()
    const tLines: { dataKey: string; name: string; color: string }[] = []

    tempMetrics.forEach((m) => {
      const key = m.system.name
      const color = colorMap.get(key) ?? SENSOR_COLORS[tLines.length % SENSOR_COLORS.length]
      tLines.push({ dataKey: key, name: key, color })
      for (const h of m.history) {
        const t = formatTime(new Date(h.recordedAt))
        const existing = tempTimeMap.get(h.recordedAt) ?? { time: t, ts: new Date(h.recordedAt).getTime() }
        existing[key] = h.value
        tempTimeMap.set(h.recordedAt, existing)
      }
    })

    // Build humidity chart
    const humidTimeMap = new Map<string, ChartDataPoint>()
    const hLines: { dataKey: string; name: string; color: string }[] = []

    humidMetrics.forEach((m) => {
      const key = m.system.name
      const color = colorMap.get(key) ?? SENSOR_COLORS[hLines.length % SENSOR_COLORS.length]
      hLines.push({ dataKey: key, name: key, color })
      for (const h of m.history) {
        const t = formatTime(new Date(h.recordedAt))
        const existing = humidTimeMap.get(h.recordedAt) ?? { time: t, ts: new Date(h.recordedAt).getTime() }
        existing[key] = h.value
        humidTimeMap.set(h.recordedAt, existing)
      }
    })

    // Sort by timestamp and downsample
    const sortedTemp = Array.from(tempTimeMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
    const sortedHumid = Array.from(humidTimeMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)

    setTempChartData(downsample(sortedTemp, 2000))
    setHumidityChartData(downsample(sortedHumid, 2000))
    setTempLines(tLines)
    setHumidityLines(hLines)
  }, [])

  // Fetch history on mount (skip if cache already has data)
  useEffect(() => {
    if (chartCache.historyLoaded && chartCache.tempChartData.length > 0) return

    async function fetchHistory() {
      try {
        const res = await fetch('/api/metrics/history?type=sensor&hours=24')
        if (!res.ok) return
        const data: MetricHistoryItem[] = await res.json()
        buildChartData(data)
        setHistoryLoaded(true)

        // History가 비어있으면 현재 realtime 값으로 seed
        const currentSystems = sensorSystemsRef.current
        if (data.every((m) => m.history.length === 0) && currentSystems.length > 0) {
          seedFromRealtimeData(currentSystems)
        }
      } catch (e) {
        console.error('[temperature] Failed to fetch history:', e)
      }
    }
    fetchHistory()
  }, [buildChartData, seedFromRealtimeData])

  // Append new data points from realtime updates (throttled to 1s)
  useEffect(() => {
    if (!historyLoaded || !lastUpdate) return

    const now = Date.now()
    if (now - lastAppendRef.current < 10000) return
    lastAppendRef.current = now

    const timeStr = formatTime(new Date())

    // Build new temp point
    const tempPoint: ChartDataPoint = { time: timeStr, ts: now }
    const humidPoint: ChartDataPoint = { time: timeStr, ts: now }
    let hasTempData = false
    let hasHumidData = false

    for (const sys of sensorSystems) {
      const tempMetric = sys.metrics?.find((m) => m.name === '온도')
      const humidMetric = sys.metrics?.find((m) => m.name === '습도')
      if (tempMetric) {
        tempPoint[sys.name] = tempMetric.value
        hasTempData = true
      }
      if (humidMetric) {
        humidPoint[sys.name] = humidMetric.value
        hasHumidData = true
      }
    }

    const cutoff = now - 24 * 60 * 60 * 1000
    if (hasTempData) {
      setTempChartData((prev) => {
        const updated = [...prev, tempPoint]
        const firstValid = updated.findIndex(p => p.ts >= cutoff)
        return firstValid > 0 ? updated.slice(firstValid) : updated
      })
    }
    if (hasHumidData) {
      setHumidityChartData((prev) => {
        const updated = [...prev, humidPoint]
        const firstValid = updated.findIndex(p => p.ts >= cutoff)
        return firstValid > 0 ? updated.slice(firstValid) : updated
      })
    }
  }, [lastUpdate, historyLoaded, sensorSystems])

  // Downsample only for rendering, forward-fill sparse sensor values, then insert gap markers
  const displayTempData = useMemo(() => {
    const ds = downsample(tempChartData, 2000)
    forwardFill(ds, tempLines.map(l => l.dataKey))
    return insertGapMarkers(ds, tempLines.map(l => l.dataKey))
  }, [tempChartData, tempLines])
  const displayHumidData = useMemo(() => {
    const ds = downsample(humidityChartData, 2000)
    forwardFill(ds, humidityLines.map(l => l.dataKey))
    return insertGapMarkers(ds, humidityLines.map(l => l.dataKey))
  }, [humidityChartData, humidityLines])

  // Temperature Y-axis: default 16~26, expand if data exceeds range
  const tempYDomain = useMemo((): [number, number] => {
    let min = 16
    let max = 26
    for (const point of displayTempData) {
      for (const line of tempLines) {
        const v = point[line.dataKey]
        if (typeof v === 'number') {
          if (v < min) min = Math.floor(v) - 1
          if (v > max) max = Math.ceil(v) + 1
        }
      }
    }
    return [min, max]
  }, [displayTempData, tempLines])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-bold">온습도</h1>
        <div className="flex items-center gap-2">
          <Select value={layoutOverride} onValueChange={(v) => setLayoutOverride(v as LayoutOverride)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4개</SelectItem>
              <SelectItem value="8">8개</SelectItem>
              <SelectItem value="16">16개</SelectItem>
            </SelectContent>
          </Select>
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md text-white hover:text-white"
          >
            <Link href="/systems/new?type=sensor">
              <PlusCircle className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>
      <div className={`grid flex-1 gap-2 overflow-hidden ${effectiveCount <= 4 ? 'grid-cols-[1.5fr_3fr]' : 'grid-cols-2'}`}>
        {/* Left column: sensor gauge cards */}
        <div className={`grid ${gridClasses} gap-2 overflow-hidden`}>
        {displaySystems.length === 0 ? (
          <Card>
            <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
              등록된 센서 시스템이 없습니다
            </CardContent>
          </Card>
        ) : (
          displaySystems.map((sys, sensorIndex) => {
            const tempMetric = sys.metrics?.find((m) => m.name === '온도')
            const humidMetric = sys.metrics?.find((m) => m.name === '습도')
            const isCompact = effectiveCount <= 4

            // Parse config to get normal range for gauge min/max and conditions
            let tempRange = { min: 0, max: 50 }
            let humidRange = { min: 0, max: 100 }
            let tempConditions: StatusConditions | null = null
            let humidConditions: StatusConditions | null = null
            if (sys.config) {
              try {
                const parsed = JSON.parse(sys.config as string) as MetricsConfig
                for (const item of parsed.displayItems ?? []) {
                  if (item.conditions) {
                    if (item.name === '온도') {
                      tempConditions = item.conditions
                      // Use normal value as gauge midpoint: min=0, max=normal*2
                      const normal = item.conditions.normal?.[0]
                      if (normal) {
                        tempRange = { min: 0, max: Math.round(normal.value1 * 2) }
                      }
                    } else if (item.name === '습도') {
                      humidConditions = item.conditions
                      // Humidity is percentage, keep 0~100
                      humidRange = { min: 0, max: 100 }
                    }
                  }
                }
              } catch { /* ignore */ }
            }

            return (
              <Link key={sys.id} href={`/systems/${sys.id}`} className="block min-h-0">
              <Card className="cursor-pointer transition-colors hover:border-primary/50 py-0 gap-0 h-full relative">
                <div className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full z-10" style={{ backgroundColor: SENSOR_COLORS[sensorIndex % SENSOR_COLORS.length] }} />
                {isCompact ? (
                  /* 4개 모드: 시설명 상단 + 온도/습도 가로 배치 + 조건 텍스트 */
                  <>
                    <CardHeader className="px-2 py-1">
                      <CardTitle className="text-sm font-medium text-center">{sys.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-2 pb-2 pt-0 flex-1 min-h-0">
                      <div className="flex flex-row gap-2 h-full">
                        {/* Temperature gauge */}
                        <div className="flex-1 flex flex-row items-center min-h-0 gap-1">
                          <div className="flex-1 min-h-0 h-full flex items-center justify-center">
                            {tempMetric ? (
                              <div className="h-[120%] aspect-square">
                                <CircularGauge
                                  value={tempMetric.value}
                                  min={tempRange.min}
                                  max={tempRange.max}
                                  unit={tempMetric.unit}
                                  label={<><Thermometer className="inline h-3 w-3 text-[#f87171]" /> 온도</>}
                                  conditions={tempConditions}
                                  trend={tempMetric.trend as TrendDirection | null}
                                  responsive
                                  showTrendIcon={false}
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </div>
                          {tempConditions && (
                            <div className="flex flex-col gap-0.5 text-[13px] text-muted-foreground shrink-0 -ml-1">
                              {tempConditions.critical?.[0] && (
                                <div className="flex items-center gap-0.5">
                                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                                  고온 {tempConditions.critical[0].value1}°C
                                </div>
                              )}
                              {tempConditions.coldCritical?.[0] && (
                                <div className="flex items-center gap-0.5">
                                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                                  저온 {tempConditions.coldCritical[0].value1}°C
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Humidity gauge */}
                        <div className="flex-1 flex flex-row items-center min-h-0 gap-1">
                          <div className="flex-1 min-h-0 h-full flex items-center justify-center">
                            {humidMetric ? (
                              <div className="h-[120%] aspect-square">
                                <CircularGauge
                                  value={humidMetric.value}
                                  min={humidRange.min}
                                  max={humidRange.max}
                                  unit={humidMetric.unit}
                                  label={<><Droplets className="inline h-3 w-3 text-[#60a5fa]" /> 습도</>}
                                  conditions={humidConditions}
                                  trend={humidMetric.trend as TrendDirection | null}
                                  responsive
                                  showTrendIcon={false}
                                />
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </div>
                          {humidConditions && (
                            <div className="flex flex-col gap-0.5 text-[13px] text-muted-foreground shrink-0 -ml-1">
                              {humidConditions.dryCritical?.[0] && (
                                <div className="flex items-center gap-0.5">
                                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                                  건조 {humidConditions.dryCritical[0].value1}%
                                </div>
                              )}
                              {humidConditions.humidCritical?.[0] && (
                                <div className="flex items-center gap-0.5">
                                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                                  다습 {humidConditions.humidCritical[0].value1}%
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </>
                ) : (
                  /* 8개/16개 모드: 기존 세로 스택 */
                  <>
                <CardHeader className="px-2 py-1">
                  <CardTitle className="text-sm font-medium text-center">{sys.name}</CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-2 pt-0 flex-1 min-h-0">
                  <div className="flex flex-col gap-3 h-full">
                    {/* Temperature gauge */}
                    <div className={`flex-1 flex ${effectiveCount >= 16 ? 'flex-row justify-center' : 'flex-col'} items-center min-h-0`}>
                      {tempMetric ? (
                        <div className={`${effectiveCount >= 16 ? 'h-full' : 'flex-1 min-h-0 w-full'} flex ${effectiveCount >= 16 ? 'items-center' : 'items-end'} justify-center`}>
                          <div className={`${effectiveCount >= 16 ? 'h-[135%]' : 'h-full max-h-full'} aspect-square`}>
                            <CircularGauge
                              value={tempMetric.value}
                              min={tempRange.min}
                              max={tempRange.max}
                              unit={tempMetric.unit}
                              label={effectiveCount >= 16 ? undefined : <><Thermometer className="inline h-3 w-3 text-[#f87171]" /> 온도</>}
                              conditions={tempConditions}
                              trend={tempMetric.trend as TrendDirection | null}
                              responsive
                              showTrendIcon={false}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center text-xs text-muted-foreground">
                          데이터 없음
                        </div>
                      )}
                      {tempConditions && (
                        <div className={`flex ${effectiveCount >= 16 ? 'flex-col gap-0.5 text-[11px] shrink-0 ml-1' : 'gap-2 text-[13px] shrink-0 -mt-1'} text-muted-foreground`}>
                          {tempConditions.critical?.[0] && (
                            <div className="flex items-center gap-0.5">
                              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                              고온 {tempConditions.critical[0].value1}°C
                            </div>
                          )}
                          {tempConditions.coldCritical?.[0] && (
                            <div className="flex items-center gap-0.5">
                              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                              저온 {tempConditions.coldCritical[0].value1}°C
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Humidity gauge */}
                    <div className={`flex-1 flex ${effectiveCount >= 16 ? 'flex-row justify-center' : 'flex-col'} items-center min-h-0`}>
                      {humidMetric ? (
                        <div className={`${effectiveCount >= 16 ? 'h-full' : 'flex-1 min-h-0 w-full'} flex ${effectiveCount >= 16 ? 'items-center' : 'items-end'} justify-center`}>
                          <div className={`${effectiveCount >= 16 ? 'h-[135%]' : 'h-full max-h-full'} aspect-square`}>
                            <CircularGauge
                              value={humidMetric.value}
                              min={humidRange.min}
                              max={humidRange.max}
                              unit={humidMetric.unit}
                              label={effectiveCount >= 16 ? undefined : <><Droplets className="inline h-3 w-3 text-[#60a5fa]" /> 습도</>}
                              conditions={humidConditions}
                              trend={humidMetric.trend as TrendDirection | null}
                              responsive
                              showTrendIcon={false}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center text-xs text-muted-foreground">
                          데이터 없음
                        </div>
                      )}
                      {humidConditions && (
                        <div className={`flex ${effectiveCount >= 16 ? 'flex-col gap-0.5 text-[11px] shrink-0 ml-1' : 'gap-2 text-[13px] shrink-0 -mt-1'} text-muted-foreground`}>
                          {humidConditions.dryCritical?.[0] && (
                            <div className="flex items-center gap-0.5">
                              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                              건조 {humidConditions.dryCritical[0].value1}%
                            </div>
                          )}
                          {humidConditions.humidCritical?.[0] && (
                            <div className="flex items-center gap-0.5">
                              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                              다습 {humidConditions.humidCritical[0].value1}%
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
                  </>
                )}
              </Card>
              </Link>
            )
          })
        )}
        </div>

        {/* Right column: charts */}
      <div className="flex flex-col gap-2 overflow-hidden">
        {/* Temperature chart */}
        <Card className="flex flex-1 flex-col overflow-hidden py-0 gap-0 cursor-pointer transition-colors hover:border-primary/50" onClick={() => router.push('/temperature/history?metric=temperature')}>
          <CardHeader className="flex-none px-2 py-1.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Thermometer className="h-4 w-4 text-[#f87171]" />
              온도
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 px-1 pb-1 pt-0">
            {displayTempData.length > 0 ? (
              <LineChart
                data={displayTempData}
                lines={tempLines}
                height="100%"
                showLegend={false}
                yDomain={tempYDomain}
                xDataKey="ts"
                xAxisType="number"
                connectNulls={false}
                xAxisTickFormatter={(ts) => {
                  const d = new Date(ts)
                  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {historyLoaded ? '이력 데이터 수집 중...' : '데이터 로딩 중...'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Humidity chart */}
        <Card className="flex flex-1 flex-col overflow-hidden py-0 gap-0 cursor-pointer transition-colors hover:border-primary/50" onClick={() => router.push('/temperature/history?metric=humidity')}>
          <CardHeader className="flex-none px-2 py-1.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Droplets className="h-4 w-4 text-[#60a5fa]" />
              습도
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 px-1 pb-1 pt-0">
            {displayHumidData.length > 0 ? (
              <LineChart
                data={displayHumidData}
                lines={humidityLines}
                height="100%"
                showLegend={false}
                yDomain={[0, 100]}
                xDataKey="ts"
                xAxisType="number"
                connectNulls={false}
                xAxisTickFormatter={(ts) => {
                  const d = new Date(ts)
                  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {historyLoaded ? '이력 데이터 수집 중...' : '데이터 로딩 중...'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  )
}
