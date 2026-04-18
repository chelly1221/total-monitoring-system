'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LineChart } from '@/components/charts/line-chart'
import { ArrowLeft, Thermometer, Droplets } from 'lucide-react'
import { insertGapMarkers, forwardFill } from '@/lib/chart-utils'

const SENSOR_COLORS = ['#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6', '#84cc16']

interface ChartDataPoint {
  time: string
  ts: number
  [key: string]: string | number | null
}

interface MetricHistoryItem {
  id: string
  name: string
  unit: string
  systemId: string
  system: { name: string }
  history: { value: number; recordedAt: string }[]
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

const PRESETS = [
  { label: '1시간', hours: 1 },
  { label: '6시간', hours: 6 },
  { label: '12시간', hours: 12 },
  { label: '24시간', hours: 24 },
  { label: '7일', hours: 24 * 7 },
  { label: '30일', hours: 24 * 30 },
] as const

function toLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TemperatureHistory() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const metricParam = searchParams.get('metric') // 'temperature' or 'humidity'

  const isHumidity = metricParam === 'humidity'
  const metricName = isHumidity ? '습도' : '온도'
  const Icon = isHumidity ? Droplets : Thermometer
  const iconColor = isHumidity ? '#60a5fa' : '#f87171'
  const title = isHumidity ? '습도 이력' : '온도 이력'

  const [activePreset, setActivePreset] = useState(3) // default: 24시간
  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [lines, setLines] = useState<{ dataKey: string; name: string; color: string }[]>([])
  const [loading, setLoading] = useState(false)

  // Custom range
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [dateFrom, setDateFrom] = useState(toLocalDate(yesterday))
  const [timeFrom, setTimeFrom] = useState(toLocalTime(yesterday))
  const [dateTo, setDateTo] = useState(toLocalDate(now))
  const [timeTo, setTimeTo] = useState(toLocalTime(now))

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        type: 'sensor',
        metricName,
        from,
        to,
      })
      const res = await fetch(`/api/metrics/history?${params}`)
      if (!res.ok) return
      const metrics: MetricHistoryItem[] = await res.json()

      const timeMap = new Map<string, ChartDataPoint>()
      const lineConfigs: { dataKey: string; name: string; color: string }[] = []

      metrics.forEach((m, i) => {
        const key = m.system.name
        lineConfigs.push({ dataKey: key, name: key, color: SENSOR_COLORS[i % SENSOR_COLORS.length] })
        for (const h of m.history) {
          const ts = new Date(h.recordedAt).getTime()
          const existing = timeMap.get(h.recordedAt) ?? { time: '', ts }
          existing[key] = h.value
          timeMap.set(h.recordedAt, existing)
        }
      })

      const sorted = Array.from(timeMap.values()).sort((a, b) => a.ts - b.ts)
      const ds = downsample(sorted, 2000)
      const keys = lineConfigs.map(l => l.dataKey)
      forwardFill(ds, keys)
      setChartData(insertGapMarkers(ds, keys))
      setLines(lineConfigs)
    } catch (e) {
      console.error('[temperature-history] fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [metricName])

  // Load data on mount and when preset changes
  useEffect(() => {
    if (activePreset < 0) return
    const preset = PRESETS[activePreset]
    const to = new Date().toISOString()
    const from = new Date(Date.now() - preset.hours * 60 * 60 * 1000).toISOString()
    fetchData(from, to)
  }, [activePreset, fetchData])

  const handleCustomQuery = () => {
    setActivePreset(-1)
    fetchData(new Date(`${dateFrom}T${timeFrom}`).toISOString(), new Date(`${dateTo}T${timeTo}`).toISOString())
  }

  // Determine X-axis formatter based on span
  const xAxisTickFormatter = useMemo(() => {
    if (chartData.length < 2) return (ts: number) => {
      const d = new Date(ts)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const spanMs = chartData[chartData.length - 1].ts - chartData[0].ts
    const fortyEightHours = 48 * 60 * 60 * 1000

    if (spanMs <= fortyEightHours) {
      return (ts: number) => {
        const d = new Date(ts)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      }
    }
    return (ts: number) => {
      const d = new Date(ts)
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  }, [chartData])

  // Y-axis domain
  const yDomain = useMemo((): [number, number] => {
    if (isHumidity) return [0, 100]
    let min = 16
    let max = 26
    for (const point of chartData) {
      for (const line of lines) {
        const v = point[line.dataKey]
        if (typeof v === 'number') {
          if (v < min) min = Math.floor(v) - 1
          if (v > max) max = Math.ceil(v) + 1
        }
      }
    }
    return [min, max]
  }, [chartData, lines, isHumidity])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0 pb-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/temperature')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Icon className="h-5 w-5" style={{ color: iconColor }} />
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 shrink-0 pb-3 flex-wrap">
        {/* Presets */}
        <div className="flex items-center gap-1">
          {PRESETS.map((p, i) => (
            <Button
              key={p.label}
              size="sm"
              variant={activePreset === i ? 'default' : 'outline'}
              className="h-7 px-3 text-xs"
              onClick={() => setActivePreset(i)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-border" />

        {/* Custom range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground [color-scheme:dark]"
          />
          <input
            type="text"
            placeholder="00:00"
            value={timeFrom}
            onChange={(e) => setTimeFrom(e.target.value)}
            className="h-7 w-[4.5rem] rounded border border-border bg-background px-2 text-xs text-foreground"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground [color-scheme:dark]"
          />
          <input
            type="text"
            placeholder="23:59"
            value={timeTo}
            onChange={(e) => setTimeTo(e.target.value)}
            className="h-7 w-[4.5rem] rounded border border-border bg-background px-2 text-xs text-foreground"
          />
          <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={handleCustomQuery}>
            조회
          </Button>
        </div>
      </div>

      {/* Chart */}
      <Card className="flex flex-1 flex-col overflow-hidden py-0 gap-0 min-h-0">
        <CardHeader className="flex-none px-2 py-1.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon className="h-4 w-4" style={{ color: iconColor }} />
            {metricName}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 px-1 pb-1 pt-0 min-h-0">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              데이터 로딩 중...
            </div>
          ) : chartData.length > 0 ? (
            <LineChart
              data={chartData}
              lines={lines}
              height="100%"
              showLegend={false}
              yDomain={yDomain}
              xDataKey="ts"
              xAxisType="number"
              connectNulls={false}
              xAxisTickFormatter={xAxisTickFormatter}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              해당 기간의 데이터가 없습니다
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
