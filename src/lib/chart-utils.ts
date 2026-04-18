/**
 * Forward-fill missing sensor values in merged time-series data.
 *
 * Each sensor reports at its own timestamp, so after merging multiple sensors
 * most data points only have a value for ONE sensor — others are `undefined`.
 * This carries each sensor's last known value forward so lines render
 * continuously.  Explicit `null` values (gap markers) are NOT overwritten.
 */
export function forwardFill<T extends Record<string, unknown>>(
  data: T[],
  valueKeys: string[],
): T[] {
  if (data.length === 0) return data
  const last: Record<string, unknown> = {}
  for (const point of data) {
    for (const key of valueKeys) {
      if (point[key] != null) {
        last[key] = point[key]
      } else if (point[key] === undefined && last[key] != null) {
        ;(point as Record<string, unknown>)[key] = last[key]
      }
    }
  }
  return data
}

/**
 * Insert null-value gap markers into time-series chart data.
 *
 * When consecutive data points are separated by more than `gapThresholdMs`,
 * a synthetic point with null values is inserted so that Recharts (with
 * connectNulls={false}) draws a visible gap instead of a straight line.
 */
export function insertGapMarkers<
  T extends Record<string, unknown> & { ts: number },
>(
  data: T[],
  valueKeys: string[],
  gapThresholdMs = 0,
): T[] {
  if (data.length < 2) return data

  // Auto threshold: max(5 min, 5× median interval) — median resists outlier skew
  let threshold = gapThresholdMs
  if (threshold <= 0) {
    const intervals: number[] = []
    for (let i = 1; i < data.length; i++) {
      intervals.push(data[i].ts - data[i - 1].ts)
    }
    intervals.sort((a, b) => a - b)
    const median = intervals[Math.floor(intervals.length / 2)]
    threshold = Math.max(300_000, median * 5)
  }

  const result: T[] = [data[0]]

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1]
    const curr = data[i]
    const gap = curr.ts - prev.ts

    if (gap > threshold) {
      // Insert a null-value marker at the midpoint of the gap
      const marker = { ts: prev.ts + 1 } as T
      for (const key of valueKeys) {
        (marker as Record<string, unknown>)[key] = null
      }
      result.push(marker)
    }

    result.push(curr)
  }

  return result
}
