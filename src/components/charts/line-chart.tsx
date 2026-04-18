'use client'

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface DataPoint {
  [key: string]: string | number | null | undefined
}

interface LineConfig {
  dataKey: string
  name: string
  color: string
}

interface LineChartProps {
  data: DataPoint[]
  lines: LineConfig[]
  height?: number | string
  showGrid?: boolean
  showLegend?: boolean
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax']
  xDataKey?: string
  xAxisType?: 'category' | 'number'
  xAxisTickFormatter?: (value: number) => string
  connectNulls?: boolean
}

function findNearest(
  values: (number | null | undefined)[],
  timestamps: number[],
  idx: number,
  currentTs: number,
  maxGap: number
): number | null {
  let left = idx - 1
  let right = idx + 1
  let bestVal: number | null = null
  let bestDist = Infinity

  while (left >= 0 || right < values.length) {
    if (left >= 0) {
      const v = values[left]
      if (v != null) {
        const dist = Math.abs(timestamps[left] - currentTs)
        if (dist < bestDist && dist <= maxGap) {
          bestDist = dist
          bestVal = v
        }
        left = -1
      } else {
        left--
      }
    }
    if (right < values.length) {
      const v = values[right]
      if (v != null) {
        const dist = Math.abs(timestamps[right] - currentTs)
        if (dist < bestDist && dist <= maxGap) {
          bestDist = dist
          bestVal = v
        }
        right = values.length
      } else {
        right++
      }
    }
    if (left < 0 && right >= values.length) break
  }

  return bestVal
}

/** Convert row-based data to uPlot columnar format */
function toColumnar(
  data: DataPoint[],
  xDataKey: string,
  lines: LineConfig[],
  isNumericX: boolean,
): [number[], ...(number | null | undefined)[][]] {
  const len = data.length
  const xs = new Array<number>(len)
  const seriesArrays: (number | null | undefined)[][] = lines.map(() => new Array(len))

  for (let i = 0; i < len; i++) {
    const raw = data[i][xDataKey]
    // uPlot wants seconds for time axes
    xs[i] = isNumericX ? (raw as number) / 1000 : i

    for (let s = 0; s < lines.length; s++) {
      const v = data[i][lines[s].dataKey]
      seriesArrays[s][i] = v == null ? null : (v as number)
    }
  }

  return [xs, ...seriesArrays] as [number[], ...(number | null | undefined)[][]]
}

export function LineChart({
  data,
  lines,
  height = 300,
  showGrid = true,
  showLegend = true,
  yDomain,
  xDataKey = 'time',
  xAxisType = 'category',
  xAxisTickFormatter,
  connectNulls = true,
}: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const uplotRef = useRef<uPlot | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipData, setTooltipData] = useState<{
    show: boolean
    left: number
    top: number
    label: string
    items: { name: string; color: string; value: string }[]
  }>({ show: false, left: 0, top: 0, label: '', items: [] })

  const isNumericX = xAxisType === 'number'

  // Stable reference to latest props for use in callbacks
  const propsRef = useRef({ data, lines, xDataKey, xAxisTickFormatter, isNumericX })
  propsRef.current = { data, lines, xDataKey, xAxisTickFormatter, isNumericX }

  const columnarData = useMemo(
    () => toColumnar(data, xDataKey, lines, isNumericX),
    [data, xDataKey, lines, isNumericX],
  )

  // Serialize lines config for structural comparison
  const linesKey = useMemo(
    () => lines.map(l => `${l.dataKey}:${l.color}`).join('|'),
    [lines],
  )

  const buildOpts = useCallback(
    (width: number, chartHeight: number): uPlot.Options => {
      const series: uPlot.Series[] = [
        // x-axis series
        {
          label: 'Time',
          value: (_, rawVal) => {
            if (rawVal == null) return '--'
            const { xAxisTickFormatter: fmt, isNumericX: numX } = propsRef.current
            if (fmt && numX) return fmt(rawVal * 1000)
            return String(rawVal)
          },
        },
        // data series
        ...lines.map((line): uPlot.Series => ({
          label: line.name,
          stroke: line.color,
          width: 2,
          paths: uPlot.paths.spline!(),
          points: { show: false },
          spanGaps: connectNulls,
        })),
      ]

      // Y-axis range
      let yRange: uPlot.Range.MinMax | undefined
      if (yDomain) {
        const [lo, hi] = yDomain
        if (typeof lo === 'number' && typeof hi === 'number') {
          yRange = [lo, hi]
        }
      }

      return {
        width,
        height: chartHeight,
        padding: [8, 12, 0, 0],
        cursor: {
          x: true,
          y: false,
          drag: { x: false, y: false, setScale: false },
        },
        hooks: {
          setCursor: [
            (u: uPlot) => {
              const { left, idx } = u.cursor
              if (left == null || left < 0 || idx == null || idx < 0) {
                setTooltipData(prev => prev.show ? { ...prev, show: false } : prev)
                return
              }

              const { data: curData, lines: curLines, xAxisTickFormatter: fmt, isNumericX: numX } = propsRef.current
              const uData = u.data

              // Format label
              const rawTs = uData[0][idx]
              let label: string
              if (fmt && numX && rawTs != null) {
                label = fmt(rawTs * 1000)
              } else {
                label = rawTs != null ? String(rawTs) : ''
              }

              // Collect values
              const items: { name: string; color: string; value: string }[] = []
              const maxGapSec = 300 // 5 minutes in seconds
              for (let s = 0; s < curLines.length; s++) {
                const seriesData = uData[s + 1] as (number | null | undefined)[]
                const directVal = seriesData[idx]
                if (directVal != null) {
                  items.push({ name: curLines[s].name, color: curLines[s].color, value: String(directVal) })
                } else {
                  // Try nearest value
                  const nearest = findNearest(
                    seriesData,
                    uData[0] as number[],
                    idx,
                    uData[0][idx],
                    maxGapSec,
                  )
                  if (nearest != null) {
                    items.push({ name: curLines[s].name, color: curLines[s].color, value: String(nearest) })
                  }
                }
              }

              if (items.length === 0) {
                setTooltipData(prev => prev.show ? { ...prev, show: false } : prev)
                return
              }

              // Position: use cursor position relative to container
              const bbox = u.over.getBoundingClientRect()
              const containerRect = containerRef.current?.getBoundingClientRect()
              if (!containerRect) return

              const tooltipLeft = bbox.left - containerRect.left + left
              const topVal = bbox.top - containerRect.top + (u.cursor.top ?? 0)

              setTooltipData({
                show: true,
                left: tooltipLeft,
                top: topVal,
                label,
                items,
              })
            },
          ],
        },
        legend: { show: showLegend },
        axes: [
          {
            stroke: '#a1a1aa',
            font: '12px sans-serif',
            ticks: { stroke: '#33333380', width: 1 },
            grid: showGrid
              ? { stroke: '#333333', width: 1, dash: [3, 3] }
              : { show: false },
            values: (_, ticks) => {
              const { xAxisTickFormatter: fmt, isNumericX: numX } = propsRef.current
              return ticks.map(v => {
                if (fmt && numX) return fmt(v * 1000)
                return String(v)
              })
            },
            gap: 5,
          },
          {
            stroke: '#a1a1aa',
            font: '12px sans-serif',
            ticks: { stroke: '#33333380', width: 1 },
            grid: showGrid
              ? { stroke: '#333333', width: 1, dash: [3, 3] }
              : { show: false },
            size: 35,
            ...(yRange ? { range: () => yRange! } : {}),
            gap: 5,
          },
        ],
        series,
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linesKey, showGrid, showLegend, connectNulls, yDomain?.[0], yDomain?.[1]],
  )

  // Create / recreate uPlot instance
  useEffect(() => {
    const el = containerRef.current
    if (!el || data.length === 0) return

    const rect = el.getBoundingClientRect()
    const w = Math.floor(rect.width) || 300
    const h = Math.floor(rect.height) || (typeof height === 'number' ? height : 300)

    const opts = buildOpts(w, h)
    const u = new uPlot(opts, columnarData as uPlot.AlignedData, el)
    uplotRef.current = u

    return () => {
      u.destroy()
      uplotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildOpts])

  // Update data without recreating
  useEffect(() => {
    const u = uplotRef.current
    if (!u || data.length === 0) return
    u.setData(columnarData as uPlot.AlignedData)
  }, [columnarData, data.length])

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver(entries => {
      const u = uplotRef.current
      if (!u) return
      const entry = entries[0]
      if (!entry) return
      const { width, height: h } = entry.contentRect
      if (width > 0 && h > 0) {
        u.setSize({ width: Math.floor(width), height: Math.floor(h) })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Hide tooltip on mouse leave
  const handleMouseLeave = useCallback(() => {
    setTooltipData(prev => prev.show ? { ...prev, show: false } : prev)
  }, [])

  const heightStyle = height === '100%' ? '100%' : typeof height === 'number' ? `${height}px` : height

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: heightStyle, position: 'relative' }}
      onMouseLeave={handleMouseLeave}
    >
      {/* Custom Tooltip */}
      {tooltipData.show && (
        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            left: tooltipData.left,
            top: tooltipData.top,
            transform: 'translate(-50%, -110%)',
            backgroundColor: '#1c1c1c',
            border: '1px solid #333333',
            borderRadius: '8px',
            padding: '4px 8px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          <p style={{ color: '#fafafa', margin: '0 0 2px 0' }}>
            {tooltipData.label}
          </p>
          {tooltipData.items.map((item) => (
            <p key={item.name} style={{ color: item.color, margin: '1px 0' }}>
              {item.name}: {item.value}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
