// Database updater for incoming metric data

import { PrismaClient } from '@prisma/client'
import { ParsedData, extractNumericValue } from './parser'
import { PortConfig } from './config'
import {
  broadcastMetric,
  broadcastSystemStatus,
  broadcastAlarm,
  broadcastAlarmResolution,
  broadcastAlarmResolutionByIds,
} from './websocket-server'
import { syncSirenState } from './siren-trigger'
import type { EquipmentConfig, MetricsConfig, SystemStatus, DisplayItem } from '@/types'
import { evaluateSensorStatus, isColdCritical, isDryCritical, isHumidCritical } from '@/lib/threshold-evaluator'
import { matchesDataConditions } from '@/lib/data-match'
import { executeCustomCode } from './custom-code-executor'
import { getLastSeen, livenessKey } from './liveness'
import { createLogger } from '@/lib/logger'

const log = createLogger('db-updater')

// Pin a single SQLite connection so the per-connection pragmas below (busy_timeout,
// synchronous) actually apply to every query — Prisma's default SQLite pool would
// otherwise leave most pooled connections without busy_timeout (=fail instantly).
// The worker already serializes its writes through the ingest drainer, so a single
// connection costs nothing here.
function withConnectionLimit(url: string): string {
  if (/[?&]connection_limit=/.test(url)) return url
  return url + (url.includes('?') ? '&' : '?') + 'connection_limit=1'
}

export const prisma = new PrismaClient({
  datasourceUrl: withConnectionLimit(process.env.DATABASE_URL || 'file:./dev.db'),
})

/**
 * Apply SQLite pragmas for safe concurrent access. WAL lets the Next.js server
 * read while the worker writes (instead of blocking each other on the rollback
 * journal's exclusive lock); busy_timeout makes a contended writer wait-and-retry
 * instead of failing; synchronous=NORMAL is the recommended durability/throughput
 * balance under WAL. journal_mode is persistent in the DB file; busy_timeout is
 * per-connection (hence the connection_limit=1 above). Awaited at worker startup
 * before any other DB query.
 */
export async function initDatabasePragmas(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;')
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000;')
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;')
    log.info('SQLite pragmas applied (journal_mode=WAL, busy_timeout=5000, synchronous=NORMAL)')
  } catch (error) {
    log.error('Failed to apply SQLite pragmas:', error)
  }
}

// Critical signal must occur CRITICAL_THRESHOLD consecutive times before triggering fault
const criticalCounters = new Map<string, number>()
const CRITICAL_THRESHOLD = 3

// Per-metric confirmed critical state: "systemId:metricName" → true when counter reached threshold
const metricCriticalState = new Map<string, boolean>()

// Per-system mutex to serialize async processing and prevent interleaving
const systemMutexes = new Map<string, Promise<void>>()

// Spike filter: rolling buffer of recent valid values per metric (sensor only)
const spikeFilterBuffers = new Map<string, number[]>()
// Consecutive spike-rejections per metric: a SUSTAINED shift must not be frozen out forever.
const spikeRejectStreaks = new Map<string, number>()
const SPIKE_BUFFER_SIZE = 20
const SPIKE_WARMUP = 5
const SPIKE_Z_THRESHOLD = 3.5
// After this many consecutive rejections, treat the change as real (sustained) and
// adopt it as the new baseline instead of rejecting forever against a stale median.
const SPIKE_REJECT_LIMIT = 3

// Flap re-arm window: a fault that clears and re-fires within this window is treated as
// the SAME ongoing alarm (occurrenceCount++ on the existing row) rather than a brand-new
// alarm + AlarmLog entry. This is what stops a value oscillating across a threshold from
// flooding the alarm log with one row per crossing.
const ALARM_REARM_MS = 5 * 60 * 1000

// AlarmLog had no retention (unlike MetricHistory) and grew forever. Prune on the same
// hourly cleanup interval.
const ALARM_LOG_RETENTION_DAYS = 365

/**
 * Raise an alarm with flap-coalescing semantics.
 *
 * Instead of inserting a fresh Alarm + AlarmLog row on every fault transition, this reuses
 * an existing OPEN alarm — or one RESOLVED within ALARM_REARM_MS — for the same
 * (system, severity), bumping occurrenceCount + lastSeenAt and reopening it if needed. A new
 * AlarmLog row is written ONLY for a genuinely new alarm episode, so chronic flapping no
 * longer floods the permanent log. It also resolves any open alarm of a DIFFERENT severity
 * for the system, fixing the previous warning<->critical accumulation (resolution used to
 * fire only on a return to 'normal'). Acknowledged alarms are never reused or superseded — a
 * re-fire after the operator has acknowledged is a genuinely new, actionable event.
 */
async function raiseAlarm(opts: {
  systemId: string
  systemName: string
  severity: 'warning' | 'critical' | 'offline'
  message: string
  value?: string | null
}): Promise<{ alarmId: string; isNew: boolean }> {
  const { systemId, systemName, severity, message } = opts
  const value = opts.value ?? null
  const now = new Date()

  // Supersede: a different-severity open alarm for this system no longer reflects reality.
  await prisma.alarm.updateMany({
    where: { systemId, resolvedAt: null, acknowledged: false, severity: { not: severity } },
    data: { resolvedAt: now },
  })

  // Coalesce: reuse an open alarm, or one resolved within the re-arm window, for this
  // (system, severity) instead of minting a new row per crossing.
  const rearmCutoff = new Date(now.getTime() - ALARM_REARM_MS)
  const existing = await prisma.alarm.findFirst({
    where: {
      systemId,
      severity,
      acknowledged: false,
      OR: [{ resolvedAt: null }, { resolvedAt: { gte: rearmCutoff } }],
    },
    orderBy: { lastSeenAt: 'desc' },
  })

  if (existing) {
    await prisma.alarm.update({
      where: { id: existing.id },
      data: {
        resolvedAt: null,
        lastSeenAt: now,
        occurrenceCount: { increment: 1 },
        message,
        value,
      },
    })
    broadcastAlarm(systemId, systemName, existing.id, severity, message, value)
    return { alarmId: existing.id, isNew: false }
  }

  const alarm = await prisma.alarm.create({
    data: { systemId, severity, message, value, firstSeenAt: now, lastSeenAt: now },
  })
  await prisma.alarmLog.create({
    data: { systemId, systemName, severity, message, value },
  })
  broadcastAlarm(systemId, systemName, alarm.id, severity, message, value)
  return { alarmId: alarm.id, isNew: true }
}

// Parsed config cache to avoid repeated JSON.parse on every data point
const configCache = new Map<string, { raw: string; parsed: Record<string, unknown> }>()

function getParsedConfig(systemId: string, configJson: string | null): Record<string, unknown> | null {
  if (!configJson) return null
  const cached = configCache.get(systemId)
  if (cached && cached.raw === configJson) return cached.parsed
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>
    configCache.set(systemId, { raw: configJson, parsed })
    return parsed
  } catch {
    return null
  }
}

/**
 * Clean up in-memory maps for a deleted system.
 */
export function cleanupSystemMaps(systemId: string): void {
  for (const key of criticalCounters.keys()) {
    if (key === systemId || key.startsWith(`${systemId}:`)) criticalCounters.delete(key)
  }
  for (const key of metricCriticalState.keys()) {
    if (key === systemId || key.startsWith(`${systemId}:`)) metricCriticalState.delete(key)
  }
  // Spike maps are keyed by `${systemId}:${metricId}`, so match that prefix.
  for (const key of spikeFilterBuffers.keys()) {
    if (key.startsWith(`${systemId}:`)) spikeFilterBuffers.delete(key)
  }
  for (const key of spikeRejectStreaks.keys()) {
    if (key.startsWith(`${systemId}:`)) spikeRejectStreaks.delete(key)
  }
  systemMutexes.delete(systemId)
  configCache.delete(systemId)
  log.debug(`Cleaned up maps for system ${systemId}`)
}

function withSystemMutex(systemId: string, fn: () => Promise<void>): Promise<void> {
  const prev = systemMutexes.get(systemId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  systemMutexes.set(systemId, next)
  return next
}

/**
 * Check if a new value is a spike using Modified Z-score (MAD-based).
 * Returns true if the value should be rejected as a spike.
 */
function isSpikeValue(metricId: string, newValue: number, metricMin: number | null, metricMax: number | null): boolean {
  const buffer = spikeFilterBuffers.get(metricId)
  if (!buffer || buffer.length < SPIKE_WARMUP) return false

  const sorted = [...buffer].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  const deviations = sorted.map(v => Math.abs(v - median))
  deviations.sort((a, b) => a - b)
  const madMid = Math.floor(deviations.length / 2)
  const mad = deviations.length % 2 === 1 ? deviations[madMid] : (deviations[madMid - 1] + deviations[madMid]) / 2

  if (mad < 0.001) {
    // MAD ≈ 0: all values nearly identical; use range-based fallback
    const range = (metricMin != null && metricMax != null) ? Math.abs(metricMax - metricMin) : 0
    const minDelta = range > 0 ? range * 0.3 : 5 // 30% of range, or absolute 5 as last resort
    const deviation = Math.abs(newValue - median)
    if (deviation > minDelta) {
      log.debug(`[SpikeFilter] Rejected metricId=${metricId} value=${newValue} (median=${median.toFixed(2)}, MAD≈0, delta=${deviation.toFixed(2)} > ${minDelta.toFixed(2)})`)
      return true
    }
    return false
  }

  const modifiedZScore = 0.6745 * Math.abs(newValue - median) / mad
  if (modifiedZScore > SPIKE_Z_THRESHOLD) {
    log.debug(`[SpikeFilter] Rejected metricId=${metricId} value=${newValue} (median=${median.toFixed(2)}, MAD=${mad.toFixed(2)}, z=${modifiedZScore.toFixed(2)})`)
    return true
  }
  return false
}

/**
 * Add a valid value to the spike filter buffer for a metric.
 */
function addToSpikeBuffer(metricId: string, value: number): void {
  let buffer = spikeFilterBuffers.get(metricId)
  if (!buffer) {
    buffer = []
    spikeFilterBuffers.set(metricId, buffer)
  }
  buffer.push(value)
  if (buffer.length > SPIKE_BUFFER_SIZE) {
    buffer.shift()
  }
}

/**
 * Spike-filter gate for sensor metrics.
 * Returns true if the value should be ACCEPTED (stored + applied), false if it
 * should be dropped as a transient spike.
 *
 * Crucially, a SUSTAINED change (SPIKE_REJECT_LIMIT consecutive rejections) is
 * adopted as the new baseline rather than rejected forever — otherwise a genuine
 * rapid shift (e.g. a cooling failure driving temperature up) would be permanently
 * filtered against a stale median, freezing the metric and suppressing the alarm.
 */
function acceptSensorValue(metricId: string, value: number, metricMin: number | null, metricMax: number | null): boolean {
  if (!isSpikeValue(metricId, value, metricMin, metricMax)) {
    spikeRejectStreaks.delete(metricId)
    addToSpikeBuffer(metricId, value)
    return true
  }

  const streak = (spikeRejectStreaks.get(metricId) ?? 0) + 1
  spikeRejectStreaks.set(metricId, streak)

  if (streak >= SPIKE_REJECT_LIMIT) {
    // Sustained shift, not a one-off spike — adopt the new level and re-seed the buffer.
    log.warn(`[SpikeFilter] Sustained shift on metricId=${metricId}: adopting value=${value} after ${streak} consecutive rejections`)
    spikeFilterBuffers.set(metricId, [value])
    spikeRejectStreaks.delete(metricId)
    return true
  }
  return false
}

const OFFLINE_CHECK_INTERVAL = parseInt(process.env.OFFLINE_CHECK_INTERVAL || '10000', 10)
const OFFLINE_THRESHOLD = parseInt(process.env.OFFLINE_THRESHOLD || '300000', 10)

let offlineCheckInterval: ReturnType<typeof setInterval> | null = null
let historyCleanupInterval: ReturnType<typeof setInterval> | null = null
let isFirstCleanupRun = true

/**
 * Calculate equipment status based on pattern matching
 */
function calculateEquipmentStatus(rawData: string, config: EquipmentConfig): SystemStatus | null {
  const trimmed = rawData.trim()

  // Check critical patterns first (highest priority)
  if (config.criticalPatterns?.some(pattern =>
    config.matchMode === 'exact' ? trimmed === pattern : trimmed.includes(pattern)
  )) {
    return 'critical'
  }

  // Check normal patterns
  if (config.normalPatterns?.some(pattern =>
    config.matchMode === 'exact' ? trimmed === pattern : trimmed.includes(pattern)
  )) {
    return 'normal'
  }

  // No match - ignore unknown messages (lastDataAt still updated for offline detection)
  return null
}

/**
 * Process a single system's metric update
 */
async function processSystemMetric(
  system: { id: string; name: string; type: string; config: string | null; metrics: { id: string; name: string; value: number; unit: string; min: number | null; max: number | null; warningThreshold: number | null; criticalThreshold: number | null }[] },
  data: ParsedData,
  numericValue: number | null
): Promise<boolean> {
  // Check if this is an equipment type system with pattern matching
  let equipmentConfig: EquipmentConfig | null = null
  const parsedConfig = getParsedConfig(system.id, system.config)
  if (parsedConfig) {
    if (parsedConfig.normalPatterns || parsedConfig.criticalPatterns) {
      equipmentConfig = parsedConfig as unknown as EquipmentConfig
    }
  }

  if (equipmentConfig) {
    // Equipment type: use pattern matching
    let newStatus = calculateEquipmentStatus(data.value, equipmentConfig)

    // Critical threshold: require CRITICAL_THRESHOLD consecutive critical signals
    if (newStatus === 'critical') {
      const count = Math.min((criticalCounters.get(system.id) ?? 0) + 1, CRITICAL_THRESHOLD)
      criticalCounters.set(system.id, count)
      if (count < CRITICAL_THRESHOLD) {
        log.debug(`${system.name}: critical count ${count}/${CRITICAL_THRESHOLD}`)
        newStatus = null // suppress until threshold reached
      } else {
        log.debug(`${system.name}: critical threshold reached (${count}/${CRITICAL_THRESHOLD})`)
      }
    } else if (newStatus !== null) {
      // Non-critical matched status → decrement counter symmetrically
      const prev = criticalCounters.get(system.id) ?? 0
      if (prev > 0) {
        const count = prev - 1
        if (count > 0) {
          criticalCounters.set(system.id, count)
          log.debug(`${system.name}: critical counter decrement ${prev}→${count}/${CRITICAL_THRESHOLD}`)
          newStatus = null // suppress normal until counter reaches 0
        } else {
          criticalCounters.delete(system.id)
          log.debug(`${system.name}: critical counter cleared, allowing status change`)
        }
      }
    }
    // null (unmatched) → counter unchanged

    // null = unmatched message → ignore (lastDataAt still updated below)
    if (newStatus === null) {
      log.debug(`${system.name}: unmatched message ignored (${data.value})`)
    } else {
      // Get current status
      const currentSystem = await prisma.system.findUnique({
        where: { id: system.id },
        select: { status: true },
      })

      // Update status if changed
      if (currentSystem && currentSystem.status !== newStatus) {
        await prisma.system.update({
          where: { id: system.id },
          data: { status: newStatus },
        })
        broadcastSystemStatus(system.id, system.name, newStatus)
        log.info(`${system.name} status: ${currentSystem.status} → ${newStatus}`)

        // Resolve alarms when system returns to normal
        if (newStatus === 'normal' && currentSystem.status !== 'normal') {
          const resolvedCount = await prisma.alarm.updateMany({
            where: {
              systemId: system.id,
              resolvedAt: null,
            },
            data: { resolvedAt: new Date() },
          })

          if (resolvedCount.count > 0) {
            log.info(`Resolved ${resolvedCount.count} alarm(s) for ${system.name}`)
            broadcastAlarmResolution(system.id, system.name)
          }

          // Sync siren state after alarm resolution
          void syncSirenState()
        }

        // Create/refresh alarm when status changes to warning or critical (flap-coalesced)
        if (newStatus === 'warning' || newStatus === 'critical') {
          const severity = newStatus === 'critical' ? 'critical' : 'warning'
          const statusLabel = newStatus === 'critical' ? '심각' : '오프라인'
          const message = `${system.name} ${statusLabel} 상태 (${data.value})`

          const { isNew } = await raiseAlarm({
            systemId: system.id,
            systemName: system.name,
            severity,
            message,
          })

          if (isNew) log.info(`Alarm created for ${system.name}: ${statusLabel}`)

          // Sync siren state after alarm creation
          void syncSirenState()
        }
      }
    }
    return true
  }

  // UPS/Sensor type: check for condition-based config
  let metricsConfig: MetricsConfig | null = null
  if (parsedConfig) {
    if ((parsedConfig.delimiter || parsedConfig.customCode) && parsedConfig.displayItems) {
      metricsConfig = parsedConfig as unknown as MetricsConfig
    }
  }

  if (metricsConfig) {
    // Two-phase processing to handle sensors that send separate messages
    // (e.g. 온습도 sends "td43.0" then "hd55.0" as individual messages).
    // Phase 1 updates only the matched metric values in DB.
    // Phase 2 evaluates system status from ALL metrics (fresh + DB-loaded),
    // preventing a normal humidity message from overriding a critical temp alarm.

    let anyProcessed = false
    const processedMetricNames = new Set<string>()

    // === Phase 1: Update matched metric values ===
    let customCodeRan = false
    if (metricsConfig.customCode?.trim()) {
      // Custom code path: run user code to extract metric values
      const codeResult = executeCustomCode(system.id, metricsConfig.customCode, data.value)
      if (codeResult === null) {
        log.error(`Custom code execution failed for system ${system.name} (${system.id}), raw: ${data.value.substring(0, 100)}`)
        return false
      }
      customCodeRan = true
      for (const [metricName, val] of Object.entries(codeResult)) {
        const displayItem = metricsConfig.displayItems.find(d => d.name === metricName)
        if (!displayItem) continue
        const metric = system.metrics.find(m => m.name === metricName)
        if (!metric) continue

        anyProcessed = true
        processedMetricNames.add(metricName)

        if (typeof val === 'string') {
          // Text metric: store in textValue, keep numeric value as 0
          const changed = (metric as unknown as { textValue?: string | null }).textValue !== val
          await prisma.metric.update({
            where: { id: metric.id },
            data: { textValue: val, trend: changed ? 'stable' : 'stable', updatedAt: new Date() },
          })
          ;(metric as unknown as { textValue?: string | null }).textValue = val
          broadcastMetric(system.id, system.name, metric.id, metric.name, metric.value, metric.unit, 'stable', val)
        } else {
          // Spike filter for sensor systems (sustained shifts are adopted, not frozen)
          if (system.type === 'sensor' && !acceptSensorValue(`${system.id}:${metric.id}`, val, metric.min, metric.max)) {
            continue
          }

          const oldValue = metric.value
          const trend = val > oldValue ? 'up' : val < oldValue ? 'down' : 'stable'

          await prisma.metric.update({
            where: { id: metric.id },
            data: { value: val, textValue: null, trend, updatedAt: new Date() },
          })

          metric.value = val

          await prisma.metricHistory.create({
            data: { metricId: metric.id, value: val },
          })

          broadcastMetric(system.id, system.name, metric.id, metric.name, val, metric.unit, trend)
        }
      }
    } else {
      // Standard delimiter path
      const rawParts = data.value.split(metricsConfig.delimiter).map(s => s.trim())

      for (const displayItem of metricsConfig.displayItems) {
        // Check data match conditions (skip if raw data doesn't match)
        if (!matchesDataConditions(data.value, displayItem.dataMatchConditions)) continue

        // When dataMatchConditions are used, the entire message may be for this metric
        // (e.g. "hd55.0" arrives as a separate message, so index 1 won't exist).
        // Fall back to the full raw data string for numeric extraction.
        const rawVal = rawParts[displayItem.index] ?? (displayItem.dataMatchConditions?.length ? data.value : undefined)
        if (rawVal === undefined) continue
        // Drop values corrupted by a decode error (U+FFFD) instead of extracting a
        // plausible-but-wrong number from a half-decoded string.
        if (rawVal.includes('�')) {
          log.warn(`${system.name}:${displayItem.name} dropped corrupt value: ${JSON.stringify(rawVal.slice(0, 32))}`)
          continue
        }
        // Extract numeric value from raw part (handles prefixed data like "td25.5")
        const numMatch = rawVal.match(/-?\d+\.?\d*/)
        if (!numMatch) continue
        const val = parseFloat(numMatch[0])
        if (isNaN(val)) continue

        anyProcessed = true
        processedMetricNames.add(displayItem.name)

        // Find matching metric in DB
        const metric = system.metrics.find(m => m.name === displayItem.name)
        if (!metric) continue

        // Spike filter for sensor systems (sustained shifts are adopted, not frozen)
        if (system.type === 'sensor' && !acceptSensorValue(`${system.id}:${metric.id}`, val, metric.min, metric.max)) {
          continue
        }

        const oldValue = metric.value
        const trend = val > oldValue ? 'up' : val < oldValue ? 'down' : 'stable'

        await prisma.metric.update({
          where: { id: metric.id },
          data: { value: val, trend, updatedAt: new Date() },
        })

        // Keep local copy in sync so Phase 2 sees fresh values
        metric.value = val

        // Record metric history for charts
        await prisma.metricHistory.create({
          data: { metricId: metric.id, value: val },
        })

        broadcastMetric(system.id, system.name, metric.id, metric.name, val, metric.unit, trend)
      }
    }

    // === Phase 2: Per-metric counter + derive system status ===
    // Wrapped in per-system mutex to prevent async interleaving when
    // separate UDP messages (e.g. temperature + humidity) arrive concurrently.
    if (anyProcessed) {
      await withSystemMutex(system.id, async () => {
        // Loop 1: Apply per-metric critical counter for processed metrics only
        for (const displayItem of metricsConfig!.displayItems) {
          if (!processedMetricNames.has(displayItem.name)) continue
          const metric = system.metrics.find(m => m.name === displayItem.name)
          if (!metric) continue
          const val = metric.value
          const counterKey = `${system.id}:${displayItem.name}`

          // Evaluate this metric's raw status
          let itemStatus: SystemStatus = 'normal'
          // Respect alarmEnabled flag for all items (including those with conditions)
          if (displayItem.alarmEnabled === false) {
            itemStatus = 'normal'
          } else {
            const textVal = (metric as unknown as { textValue?: string | null }).textValue
            if (displayItem.conditions) {
              if (textVal != null) {
                // Text metric: evaluate string conditions (eq/neq)
                for (const cond of displayItem.conditions.critical || []) {
                  const target = cond.stringValue ?? String(cond.value1)
                  if (cond.operator === 'eq' && textVal === target) { itemStatus = 'critical'; break }
                  if (cond.operator === 'neq' && textVal !== target) { itemStatus = 'critical'; break }
                }
              } else {
                itemStatus = evaluateSensorStatus(val, displayItem.conditions)
                // If conditions exist but have no critical conditions, fall back to legacy thresholds
                if (itemStatus === 'normal' && !(displayItem.conditions.critical?.length || displayItem.conditions.coldCritical?.length || displayItem.conditions.dryCritical?.length || displayItem.conditions.humidCritical?.length)) {
                  if (displayItem.critical !== null && val >= displayItem.critical) itemStatus = 'critical'
                  else if (displayItem.warning !== null && val <= displayItem.warning) itemStatus = 'critical'
                }
              }
            } else {
              if (displayItem.critical !== null && val >= displayItem.critical) itemStatus = 'critical'
              else if (displayItem.warning !== null && val <= displayItem.warning) itemStatus = 'critical'
            }
          }

          // Per-metric critical counter
          if (itemStatus === 'critical') {
            const count = Math.min((criticalCounters.get(counterKey) ?? 0) + 1, CRITICAL_THRESHOLD)
            criticalCounters.set(counterKey, count)
            if (count >= CRITICAL_THRESHOLD) {
              metricCriticalState.set(counterKey, true)
            }
            log.debug(`${system.name}:${displayItem.name} critical count ${count}/${CRITICAL_THRESHOLD}`)
          } else {
            // Symmetric decrement: require CRITICAL_THRESHOLD consecutive non-criticals
            // to clear, so a single transient or mis-parsed normal reading between
            // criticals does not reset confirmation and delay/suppress a real alarm.
            const prev = criticalCounters.get(counterKey) ?? 0
            if (prev > 0) {
              const count = prev - 1
              if (count > 0) {
                criticalCounters.set(counterKey, count)
                log.debug(`${system.name}:${displayItem.name} non-critical, counter decrement ${prev}→${count}/${CRITICAL_THRESHOLD}`)
              } else {
                criticalCounters.delete(counterKey)
                metricCriticalState.delete(counterKey)
                log.debug(`${system.name}:${displayItem.name} non-critical, counter cleared (was ${prev})`)
              }
            }
          }
        }

        // Loop 2: Derive system status from ALL metrics' confirmed states
        let worstStatus: SystemStatus = 'normal'
        let coldTriggered = false
        let dryTriggered = false
        let humidTriggered = false
        let hotTriggered = false
        const triggerValues: Record<string, string> = {}

        for (const displayItem of metricsConfig!.displayItems) {
          const counterKey = `${system.id}:${displayItem.name}`
          const metric = system.metrics.find(m => m.name === displayItem.name)
          if (!metric) continue

          if (metricCriticalState.get(counterKey)) {
            worstStatus = 'critical'
            const valueStr = `${metric.value}${displayItem.unit}`
            // Determine trigger type for alarm message
            if (displayItem.conditions) {
              if (system.type === 'sensor') {
                // Sensor: distinguish 고온/저온/건조/다습
                if (isColdCritical(metric.value, displayItem.conditions)) { coldTriggered = true; triggerValues['저온 경고'] = valueStr }
                else if (isDryCritical(metric.value, displayItem.conditions)) { dryTriggered = true; triggerValues['건조 경고'] = valueStr }
                else if (isHumidCritical(metric.value, displayItem.conditions)) { humidTriggered = true; triggerValues['다습 경고'] = valueStr }
                else { hotTriggered = true; triggerValues['고온 경고'] = valueStr }
              } else {
                // UPS/other: per-item threshold key
                triggerValues[`${displayItem.name} 임계치 초과`] = valueStr
              }
            } else {
              if (displayItem.critical !== null && metric.value >= displayItem.critical) { hotTriggered = true; triggerValues[`${displayItem.name} 임계치 초과`] = valueStr }
              if (displayItem.warning !== null && metric.value <= displayItem.warning) { coldTriggered = true; triggerValues[`${displayItem.name} 임계치 초과`] = valueStr }
            }
          } else {
            // Check threshold status (no counter needed)
            if (!displayItem.conditions && displayItem.alarmEnabled !== false) {
              const valueStr = `${metric.value}${displayItem.unit}`
              if (displayItem.critical !== null && metric.value >= displayItem.critical && worstStatus !== 'critical') {
                worstStatus = 'critical'
                triggerValues[`${displayItem.name} 임계치 초과`] = valueStr
              } else if (displayItem.warning !== null && metric.value <= displayItem.warning && worstStatus !== 'critical') {
                worstStatus = 'critical'
                triggerValues[`${displayItem.name} 임계치 초과`] = valueStr
              }
            }
          }
        }

        const allItemLabels = system.type !== 'sensor'
          ? metricsConfig!.displayItems
              .filter(d => d.alarmEnabled !== false)
              .map(d => `${d.name} 임계치 초과`)
          : undefined
        await updateSensorSystemStatus(system.id, system.name, worstStatus, coldTriggered, dryTriggered, humidTriggered, hotTriggered, system.type, triggerValues, allItemLabels)
      })
    }
    // For custom code: even if this particular line didn't match any metrics
    // (e.g. apcupsd HOSTNAME line), the code ran successfully so we should
    // update lastDataAt to prevent false offline detection.
    return anyProcessed || customCodeRan
  }

  if (numericValue !== null && system.metrics.length > 0) {
    // Legacy UPS mode: single numeric threshold
    const metric = system.metrics[0]
    const oldValue = metric.value
    const trend = numericValue > oldValue ? 'up' : numericValue < oldValue ? 'down' : 'stable'

    await prisma.metric.update({
      where: { id: metric.id },
      data: {
        value: numericValue,
        trend,
        updatedAt: new Date(),
      },
    })

    // Record metric history for charts
    await prisma.metricHistory.create({
      data: { metricId: metric.id, value: numericValue },
    })

    broadcastMetric(
      system.id,
      system.name,
      metric.id,
      metric.name,
      numericValue,
      metric.unit,
      trend
    )

    // Check thresholds and update system status
    await updateSystemStatus(system.id, system.name, numericValue, metric, metric.unit)
    return true
  }

  return false
}

/**
 * Update metric in database based on incoming data.
 * Finds all systems registered on the given port/protocol and processes each.
 */
export async function updateMetric(config: PortConfig, data: ParsedData, port: number, protocol: 'udp' | 'tcp' | 'mqtt', topic?: string): Promise<void> {
  try {
    // Find all systems for this source. MQTT systems are matched by topic (they have
    // no bound port); UDP/TCP systems by port+protocol.
    const where = protocol === 'mqtt'
      ? { protocol: 'mqtt', topic, isEnabled: true, isActive: true }
      : { port, protocol, isEnabled: true, isActive: true }
    const systems = await prisma.system.findMany({
      where,
      include: { metrics: true },
    })

    if (systems.length === 0) {
      log.debug(protocol === 'mqtt' ? `No systems found for topic ${topic}` : `No systems found for port ${port}/${protocol}`)
      return
    }

    const numericValue = extractNumericValue(data)

    for (const system of systems) {
      try {
        const processed = await processSystemMetric(system, data, numericValue)

        // Advance lastDataAt on EVERY received packet, regardless of whether the
        // payload parsed. Offline must mean "no bytes arriving on this port", not
        // "no parseable value" — otherwise an alive device emitting a transiently
        // malformed or format-changed frame is falsely marked offline after the
        // threshold. (Equipment already behaved this way; sensor/UPS now match.)
        await prisma.system.update({
          where: { id: system.id },
          data: {
            lastDataAt: new Date(),
            updatedAt: new Date(),
          },
        })

        if (processed) {
          log.debug(`Updated ${system.name}: ${data.value}`)
        }
      } catch (error) {
        log.error(`Error processing system ${system.name}:`, error)
      }
    }
  } catch (error) {
    log.error(`Error updating port ${port}/${protocol}:`, error)
  }
}

/**
 * Update system status based on metric thresholds
 */
async function updateSystemStatus(
  systemId: string,
  systemName: string,
  value: number,
  metric: { warningThreshold: number | null; criticalThreshold: number | null },
  unit: string = ''
): Promise<void> {
  try {
  let status: 'normal' | 'warning' | 'critical' = 'normal'

  if (metric.criticalThreshold !== null && value >= metric.criticalThreshold) {
    status = 'critical'
  } else if (metric.warningThreshold !== null && value <= metric.warningThreshold) {
    status = 'critical'
  }

  // Fetch current system status (used for both counter suppression and change detection)
  const currentSystem = await prisma.system.findUnique({
    where: { id: systemId },
    select: { status: true },
  })

  // Critical threshold: require CRITICAL_THRESHOLD consecutive critical signals
  if (status === 'critical') {
    const count = Math.min((criticalCounters.get(systemId) ?? 0) + 1, CRITICAL_THRESHOLD)
    criticalCounters.set(systemId, count)
    if (count < CRITICAL_THRESHOLD) {
      log.debug(`${systemName}: critical count ${count}/${CRITICAL_THRESHOLD}`)
      if (currentSystem) status = currentSystem.status as 'normal' | 'warning' | 'critical'
    } else {
      log.debug(`${systemName}: critical threshold reached (${count}/${CRITICAL_THRESHOLD})`)
    }
  } else {
    // Symmetric decrement: require CRITICAL_THRESHOLD consecutive non-critical to exit
    const prev = criticalCounters.get(systemId) ?? 0
    if (prev > 0) {
      const count = prev - 1
      if (count > 0) {
        criticalCounters.set(systemId, count)
        log.debug(`${systemName}: critical counter decrement ${prev}→${count}/${CRITICAL_THRESHOLD}`)
        if (currentSystem) status = currentSystem.status as 'normal' | 'warning' | 'critical'
      } else {
        criticalCounters.delete(systemId)
        log.debug(`${systemName}: critical counter cleared, allowing status change`)
      }
    }
  }

  await prisma.system.update({
    where: { id: systemId },
    data: { status },
  })

  // Broadcast status change if different
  if (currentSystem && currentSystem.status !== status) {
    broadcastSystemStatus(systemId, systemName, status)

    // Resolve alarms when system returns to normal
    if (status === 'normal' && currentSystem.status !== 'normal') {
      const resolvedCount = await prisma.alarm.updateMany({
        where: {
          systemId: systemId,
          resolvedAt: null,
        },
        data: { resolvedAt: new Date() },
      })

      if (resolvedCount.count > 0) {
        log.info(`Resolved ${resolvedCount.count} alarm(s) for ${systemName}`)
        broadcastAlarmResolution(systemId, systemName)
      }

      // Sync siren state after alarm resolution
      void syncSirenState()
    }

    // Create/refresh alarm when status changes to warning or critical (flap-coalesced)
    if (status === 'warning' || status === 'critical') {
      const severity = 'critical' as const
      const statusLabel = '임계치 초과'
      const alarmValue = `${value}${unit}`

      const { isNew } = await raiseAlarm({
        systemId,
        systemName,
        severity,
        message: `${systemName} ${statusLabel} 상태`,
        value: alarmValue,
      })

      if (isNew) log.info(`Alarm created for ${systemName}: ${statusLabel}`)

      // Sync siren state after alarm creation
      void syncSirenState()
    }
  }
  } catch (error) {
    log.error(`Error in updateSystemStatus for ${systemName}:`, error)
  }
}

/**
 * Update system status for condition-based sensor systems
 */
async function updateSensorSystemStatus(
  systemId: string,
  systemName: string,
  status: SystemStatus,
  coldTriggered: boolean,
  dryTriggered: boolean,
  humidTriggered: boolean,
  hotTriggered: boolean,
  systemType: string = 'sensor',
  triggerValues: Record<string, string> = {},
  allItemLabels?: string[]
): Promise<void> {
  try {
  const currentSystem = await prisma.system.findUnique({
    where: { id: systemId },
    select: { status: true },
  })

  if (!currentSystem) return

  const statusChanged = currentSystem.status !== status

  // Normal + unchanged: just clean stale alarms and return
  if (status === 'normal' && !statusChanged) {
    const staleAlarms = await prisma.alarm.updateMany({
      where: { systemId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    })
    if (staleAlarms.count > 0) {
      log.info(` Cleaned up ${staleAlarms.count} stale alarm(s) for ${systemName}`)
      broadcastAlarmResolution(systemId, systemName)
      void syncSirenState()
    }
    return
  }

  // Update system status only if changed
  if (statusChanged) {
    await prisma.system.update({
      where: { id: systemId },
      data: { status },
    })

    broadcastSystemStatus(systemId, systemName, status)
  }

  // Resolve all alarms when system returns to normal
  if (status === 'normal') {
    const resolvedCount = await prisma.alarm.updateMany({
      where: { systemId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    })

    if (resolvedCount.count > 0) {
      log.info(` Resolved ${resolvedCount.count} alarm(s) for ${systemName}`)
      broadcastAlarmResolution(systemId, systemName)
    }

    void syncSirenState()
  }

  // Create one alarm per triggered type (warning or critical)
  if (status === 'warning' || status === 'critical') {
    const severity = status === 'critical' ? 'critical' : 'warning'

    const triggeredLabels: string[] = []
    if (systemType === 'sensor') {
      if (hotTriggered) triggeredLabels.push('고온 경고')
      if (coldTriggered) triggeredLabels.push('저온 경고')
      if (dryTriggered) triggeredLabels.push('건조 경고')
      if (humidTriggered) triggeredLabels.push('다습 경고')
    }
    if (triggeredLabels.length === 0) {
      const tvKeys = Object.keys(triggerValues)
      if (tvKeys.length > 0) {
        triggeredLabels.push(...tvKeys)
      } else {
        triggeredLabels.push(status === 'critical' ? '임계치 초과' : '오프라인')
      }
    }

    let created = false
    for (const statusLabel of triggeredLabels) {
      const message = `${systemName} ${statusLabel} 상태`
      // Skip if unresolved alarm with this message already exists
      const existing = await prisma.alarm.findFirst({
        where: { systemId, message, resolvedAt: null },
      })
      if (existing) {
        // Update value on existing alarm if not yet set
        const alarmVal = triggerValues[statusLabel] ?? null
        if (alarmVal && !existing.value) {
          await prisma.alarm.update({
            where: { id: existing.id },
            data: { value: alarmVal },
          })
        }
        continue
      }

      const alarmValue = triggerValues[statusLabel] ?? null
      const alarm = await prisma.alarm.create({
        data: { systemId, severity, message, value: alarmValue },
      })

      await prisma.alarmLog.create({
        data: { systemId, systemName, severity, message, value: alarmValue },
      })

      broadcastAlarm(systemId, systemName, alarm.id, severity, message, alarmValue)
      log.info(` Alarm created for ${systemName}: ${statusLabel}`)
      created = true
    }

    // Clean up legacy generic "임계치 초과" alarms for non-sensor systems
    const resolvedAlarmIds: string[] = []
    if (systemType !== 'sensor') {
      const legacyMessage = `${systemName} 임계치 초과 상태`
      const legacyAlarms = await prisma.alarm.findMany({
        where: { systemId, message: legacyMessage, resolvedAt: null },
        select: { id: true },
      })
      if (legacyAlarms.length > 0) {
        await prisma.alarm.updateMany({
          where: { id: { in: legacyAlarms.map(a => a.id) } },
          data: { resolvedAt: new Date() },
        })
        resolvedAlarmIds.push(...legacyAlarms.map(a => a.id))
        log.info(` Resolved legacy generic alarm(s) for ${systemName}`)
      }
    }

    // Resolve alarms for types no longer triggered
    const allLabels = systemType === 'sensor'
      ? ['고온 경고', '저온 경고', '건조 경고', '다습 경고']
      : allItemLabels || ['임계치 초과']
    const untriggeredLabels = allLabels.filter(l => !triggeredLabels.includes(l))
    for (const label of untriggeredLabels) {
      const message = `${systemName} ${label} 상태`
      const toResolve = await prisma.alarm.findMany({
        where: { systemId, message, resolvedAt: null },
        select: { id: true },
      })
      if (toResolve.length > 0) {
        await prisma.alarm.updateMany({
          where: { id: { in: toResolve.map(a => a.id) } },
          data: { resolvedAt: new Date() },
        })
        resolvedAlarmIds.push(...toResolve.map(a => a.id))
        log.info(` Resolved ${label} alarm(s) for ${systemName}`)
      }
    }
    if (resolvedAlarmIds.length > 0) {
      broadcastAlarmResolutionByIds(systemId, systemName, resolvedAlarmIds)
    }

    if (created || resolvedAlarmIds.length > 0) void syncSirenState()
  }
  } catch (error) {
    log.error(` Error in updateSensorSystemStatus for ${systemName}:`, error)
  }
}

/**
 * Process alarm data and create alarm records if needed
 */
export async function processAlarm(config: PortConfig, data: ParsedData): Promise<void> {
  try {
    const system = await prisma.system.findFirst({
      where: {
        OR: [
          { name: { contains: config.system } },
          { name: config.system },
        ],
      },
    })

    if (!system) {
      log.info(` Alarm system not found: ${config.system}`)
      return
    }

    // Parse alarm data (implementation depends on actual alarm format)
    const alarmValue = data.value.trim()
    const isAlarm = alarmValue !== '' && alarmValue !== '0' && alarmValue.toLowerCase() !== 'ok'
    const newStatus = isAlarm ? 'warning' : 'normal'

    // Edge-triggered: only act on an actual status transition. Previously this fired on
    // EVERY non-OK packet (level-triggered), inserting one Alarm + AlarmLog row per packet.
    const current = await prisma.system.findUnique({
      where: { id: system.id },
      select: { status: true },
    })
    if (!current || current.status === newStatus) return

    await prisma.system.update({
      where: { id: system.id },
      data: { status: newStatus },
    })
    broadcastSystemStatus(system.id, system.name, newStatus)

    if (isAlarm) {
      const { isNew } = await raiseAlarm({
        systemId: system.id,
        systemName: system.name,
        severity: 'warning',
        message: `Alarm triggered: ${alarmValue}`,
      })
      if (isNew) log.info(` Alarm created for ${config.system}: ${alarmValue}`)
      void syncSirenState()
    } else {
      // Cleared: resolve any open alarms for this system. Previously processAlarm never
      // resolved, so an alarm it raised stayed active until offline detection or restart.
      const resolved = await prisma.alarm.updateMany({
        where: { systemId: system.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      })
      if (resolved.count > 0) {
        broadcastAlarmResolution(system.id, system.name)
        log.info(` Alarm cleared for ${config.system}`)
      }
      void syncSirenState()
    }
  } catch (error) {
    log.error(` Error processing alarm for ${config.system}:`, error)
  }
}

/**
 * Create alarm records for systems that are already offline but have no active alarm.
 * Called at worker startup to catch systems that were offline before the worker started.
 */
export async function syncOfflineAlarms(): Promise<void> {
  try {
    const offlineSystems = await prisma.system.findMany({
      where: {
        isEnabled: true,
        isActive: true,
        status: 'offline',
        alarms: { none: { resolvedAt: null } },
      },
    })

    for (const sys of offlineSystems) {
      const severity = 'offline' as const
      const alarm = await prisma.alarm.create({
        data: {
          systemId: sys.id,
          severity,
          message: `${sys.name} 오프라인`,
        },
      })

      broadcastAlarm(sys.id, sys.name, alarm.id, severity, `${sys.name} 오프라인`)
      log.info(` Created offline alarm for ${sys.name} (sync, severity=${severity})`)
    }

    // Also sync critical/warning UPS systems that have no active alarm
    const criticalUpsSystems = await prisma.system.findMany({
      where: {
        isEnabled: true,
        isActive: true,
        type: 'ups',
        status: { in: ['critical', 'warning'] },
        alarms: { none: { resolvedAt: null } },
      },
      include: { metrics: true },
    })

    for (const sys of criticalUpsSystems) {
      let metricsConfig: MetricsConfig | null = null
      const cachedSysCfg = getParsedConfig(sys.id, sys.config)
      if (cachedSysCfg && (cachedSysCfg.delimiter || cachedSysCfg.customCode) && cachedSysCfg.displayItems) {
        metricsConfig = cachedSysCfg as unknown as MetricsConfig
      }

      if (metricsConfig) {
        let anyCreated = false
        for (const displayItem of metricsConfig.displayItems) {
          if (displayItem.alarmEnabled === false) continue
          const metric = sys.metrics.find(m => m.name === displayItem.name)
          if (!metric) continue

          let exceeded = false
          if (displayItem.conditions) {
            const itemStatus = evaluateSensorStatus(metric.value, displayItem.conditions)
            exceeded = itemStatus === 'critical'
          } else {
            if (displayItem.critical !== null && metric.value >= displayItem.critical) exceeded = true
            else if (displayItem.warning !== null && metric.value <= displayItem.warning) exceeded = true
          }
          if (!exceeded) continue

          const statusLabel = `${displayItem.name} 임계치 초과`
          const message = `${sys.name} ${statusLabel} 상태`
          const value = `${metric.value}${displayItem.unit}`

          const alarm = await prisma.alarm.create({
            data: { systemId: sys.id, severity: 'critical', message, value },
          })
          await prisma.alarmLog.create({
            data: { systemId: sys.id, systemName: sys.name, severity: 'critical', message, value },
          })
          broadcastAlarm(sys.id, sys.name, alarm.id, 'critical', message, value)
          anyCreated = true
        }
        if (!anyCreated) {
          // Fallback: no individual item exceeded, create generic alarm
          const alarm = await prisma.alarm.create({
            data: { systemId: sys.id, severity: 'critical', message: `${sys.name} 임계치 초과 상태` },
          })
          await prisma.alarmLog.create({
            data: { systemId: sys.id, systemName: sys.name, severity: 'critical', message: `${sys.name} 임계치 초과 상태` },
          })
          broadcastAlarm(sys.id, sys.name, alarm.id, 'critical', `${sys.name} 임계치 초과 상태`)
        }
      } else {
        // No metrics config: fallback to generic alarm
        const alarm = await prisma.alarm.create({
          data: { systemId: sys.id, severity: 'critical', message: `${sys.name} 임계치 초과 상태` },
        })
        await prisma.alarmLog.create({
          data: { systemId: sys.id, systemName: sys.name, severity: 'critical', message: `${sys.name} 임계치 초과 상태` },
        })
        broadcastAlarm(sys.id, sys.name, alarm.id, 'critical', `${sys.name} 임계치 초과 상태`)
      }

      log.info(` Created critical alarm for UPS ${sys.name} (sync)`)
    }

    const totalSynced = offlineSystems.length + criticalUpsSystems.length
    if (totalSynced > 0) {
      log.info(` Synced ${totalSynced} alarm(s) (${offlineSystems.length} offline, ${criticalUpsSystems.length} UPS critical)`)
    }
  } catch (error) {
    log.error(' Error syncing offline alarms:', error)
  }
}

/**
 * Start the offline detection check interval
 */
export function startOfflineDetection(): void {
  if (offlineCheckInterval) return

  log.info(` Starting offline detection (default ${Math.round(OFFLINE_THRESHOLD / 60000)}min threshold, per-device overridable)`)

  offlineCheckInterval = setInterval(async () => {
    try {
      const systems = await prisma.system.findMany({
        where: {
          isEnabled: true,
          isActive: true,
          status: { not: 'offline' },
        },
      })

      const now = Date.now()

      for (const system of systems) {
        const dbLast = system.lastDataAt?.getTime() ?? 0
        // Fall back to the in-memory receive timestamp (recorded synchronously on the
        // socket/MQTT receive path, before the queue). A stalled drainer or a briefly
        // locked DB delays the lastDataAt write but must NOT manufacture a false
        // offline — liveness reflects bytes on the wire. Use whichever is more recent.
        const memLast = getLastSeen(
          livenessKey(system.protocol, system.port, (system as { topic?: string | null }).topic),
        )
        const lastData = Math.max(dbLast, memLast)
        const timeSinceLastData = now - lastData
        // Per-device threshold overrides the global default (slow reporters need a
        // longer window; fast-critical devices a shorter one). Guard with > 0 (not
        // ??) so a stored 0/garbage value can never force permanent instant offline.
        const t = (system as { offlineThreshold?: number | null }).offlineThreshold
        const threshold = (typeof t === 'number' && t > 0) ? t : OFFLINE_THRESHOLD

        if (timeSinceLastData > threshold) {
          // Message reflects the actual elapsed silence, not a hardcoded constant.
          const minutesSilent = Math.max(1, Math.round(timeSinceLastData / 60000))
          const offlineMsg = `${system.name} 오프라인 (${minutesSilent}분 이상 데이터 없음)`
          log.info(` System "${system.name}" offline (${Math.round(timeSinceLastData / 1000)}s since last data, threshold ${Math.round(threshold / 1000)}s)`)

          // Update status to offline
          await prisma.system.update({
            where: { id: system.id },
            data: { status: 'offline' },
          })

          const severity = 'offline' as const

          // Create offline alarm
          const alarm = await prisma.alarm.create({
            data: {
              systemId: system.id,
              severity,
              message: offlineMsg,
            },
          })

          // Log the alarm
          await prisma.alarmLog.create({
            data: {
              systemId: system.id,
              systemName: system.name,
              severity,
              message: offlineMsg,
            },
          })

          // Broadcast status change and alarm
          broadcastSystemStatus(system.id, system.name, 'offline')
          broadcastAlarm(
            system.id,
            system.name,
            alarm.id,
            severity,
            offlineMsg
          )
        }
      }

      // Backfill alarms for systems that are ALREADY offline (or UPS critical) but have no
      // open alarm — e.g. systems created after worker startup, which default to 'offline'
      // and are skipped by the transition loop above. This replaces the DB-write that used
      // to live (incorrectly) in the /alarms page GET render.
      await syncOfflineAlarms()
    } catch (error) {
      log.error(' Offline detection error:', error)
    }
  }, OFFLINE_CHECK_INTERVAL)
}

/**
 * Stop the offline detection check interval
 */
export function stopOfflineDetection(): void {
  if (offlineCheckInterval) {
    clearInterval(offlineCheckInterval)
    offlineCheckInterval = null
    log.info(' Offline detection stopped')
  }
}

export interface BindingSystem {
  name: string
  type: string
  port: number | null
  protocol: string | null
  encoding: string | null
  topic: string | null
}

/**
 * Fetch enabled+active systems the dynamic binder should listen for: those with a
 * port (UDP/TCP) or an MQTT topic. The binder unions UDP/TCP ports with the static
 * config.ts defaults and subscribes the MQTT topics, so a UI-created system actually
 * gets a listener/subscription.
 */
export async function getEnabledSystemsForBinding(): Promise<BindingSystem[]> {
  return prisma.system.findMany({
    where: {
      isEnabled: true,
      isActive: true,
      OR: [
        { port: { not: null } },
        { protocol: 'mqtt', topic: { not: null } },
      ],
    },
    select: { name: true, type: true, port: true, protocol: true, encoding: true, topic: true },
  })
}

/**
 * Start periodic cleanup and downsampling of metric history.
 * Retention policy:
 *   - Raw data: 7 days
 *   - 10-min averages: 7–31 days
 *   - 30-min averages: 31–365 days
 *   - Delete: >365 days
 * Runs every hour.
 */
export function startHistoryCleanup(): void {
  if (historyCleanupInterval) return

  log.info(' Starting metric history cleanup (365d tiered retention)')
  isFirstCleanupRun = true

  // Run cleanup immediately on start
  cleanOldHistory()

  historyCleanupInterval = setInterval(cleanOldHistory, 60 * 60 * 1000) // 1 hour
}

async function cleanOldHistory(): Promise<void> {
  try {
    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000
    const HOUR = 60 * 60 * 1000
    const yearCutoff = new Date(now - 365 * DAY)
    const d31 = new Date(now - 31 * DAY)
    const d7 = new Date(now - 7 * DAY)

    // 1. Delete data older than 365 days
    const deleted = await prisma.metricHistory.deleteMany({
      where: { recordedAt: { lt: yearCutoff } },
    })
    if (deleted.count > 0) {
      log.info(` Deleted ${deleted.count} records older than 365 days`)
    }

    // 1b. Prune permanent alarm log (previously unbounded).
    const alarmLogCutoff = new Date(now - ALARM_LOG_RETENTION_DAYS * DAY)
    const prunedAlarmLogs = await prisma.alarmLog.deleteMany({
      where: { createdAt: { lt: alarmLogCutoff } },
    })
    if (prunedAlarmLogs.count > 0) {
      log.info(` Deleted ${prunedAlarmLogs.count} alarm logs older than ${ALARM_LOG_RETENTION_DAYS} days`)
    }

    if (isFirstCleanupRun) {
      // Full-range processing on startup (catches up after extended downtime)
      isFirstCleanupRun = false

      const r30 = await downsampleRange(yearCutoff, d31, 30)
      if (r30 > 0) log.info(` Startup 30-min downsample: reduced ${r30} records`)

      const r10 = await downsampleRange(d31, d7, 10)
      if (r10 > 0) log.info(` Startup 10-min downsample: reduced ${r10} records`)
    } else {
      // Incremental: only process 2-hour windows at each boundary

      // 31-day boundary → downsample to 30-min averages
      const r30 = await downsampleRange(
        new Date(now - 31 * DAY - 2 * HOUR),
        d31,
        30,
      )
      if (r30 > 0) log.info(` 30-min downsample: reduced ${r30} records`)

      // 7-day boundary → downsample to 10-min averages
      const r10 = await downsampleRange(
        new Date(now - 7 * DAY - 2 * HOUR),
        d7,
        10,
      )
      if (r10 > 0) log.info(` 10-min downsample: reduced ${r10} records`)
    }
  } catch (error) {
    log.error(' History cleanup error:', error)
  }
}

/**
 * Downsample MetricHistory records in a time range to the specified interval.
 * Groups records by metricId and time bucket, replaces with averaged values.
 * Skips if data is already at the target resolution.
 * Returns the number of records reduced.
 */
async function downsampleRange(
  rangeStart: Date,
  rangeEnd: Date,
  intervalMinutes: number,
): Promise<number> {
  if (rangeStart >= rangeEnd) return 0

  const intervalSeconds = intervalMinutes * 60
  const startISO = rangeStart.toISOString()
  const endISO = rangeEnd.toISOString()

  // Count current records in range
  const currentCount = await prisma.metricHistory.count({
    where: { recordedAt: { gte: rangeStart, lt: rangeEnd } },
  })
  if (currentCount === 0) return 0

  // Get averaged data grouped by metric and time bucket
  const averaged = await prisma.$queryRaw<
    Array<{ metricId: string; avgValue: number; bucketEpoch: bigint }>
  >`SELECT
       metricId,
       AVG(value) as avgValue,
       (CAST(strftime('%s', recordedAt) AS INTEGER) / ${intervalSeconds}) * ${intervalSeconds} as bucketEpoch
     FROM metric_history
     WHERE recordedAt >= ${startISO} AND recordedAt < ${endISO}
     GROUP BY metricId, bucketEpoch`

  // If bucket count matches record count, already at target resolution
  if (averaged.length >= currentCount) return 0

  // Replace records with downsampled versions in a single transaction
  await prisma.$transaction(
    async (tx) => {
      // Delete all records in range
      await tx.$executeRaw`DELETE FROM metric_history WHERE recordedAt >= ${startISO} AND recordedAt < ${endISO}`

      // Insert averaged records
      for (const row of averaged) {
        const ts = new Date(Number(row.bucketEpoch) * 1000).toISOString()
        await tx.$executeRaw`INSERT INTO metric_history (id, metricId, value, recordedAt) VALUES (lower(hex(randomblob(12))), ${row.metricId}, ${Number(row.avgValue)}, ${ts})`
      }
    },
    { timeout: 120000 },
  )

  return currentCount - averaged.length
}

/**
 * Stop the history cleanup interval
 */
export function stopHistoryCleanup(): void {
  if (historyCleanupInterval) {
    clearInterval(historyCleanupInterval)
    historyCleanupInterval = null
    log.info(' History cleanup stopped')
  }
}

/**
 * Graceful shutdown - close database connection
 */
export async function closeDatabase(): Promise<void> {
  stopOfflineDetection()
  stopHistoryCleanup()
  await prisma.$disconnect()
}
