// Storage and alarm enrichment for 네트워크 ping 감시 failure / recovery events.
// The client posts events to POST /api/ping-events; the worker and the alarm UI
// read them back so a PING_FAIL alarm names the target that actually failed.

import { prisma } from '@/lib/db'
import {
  PING_EVENT_RETENTION_DAYS,
  PING_FAILURE_MATCH_WINDOW_MS,
  currentlyFailedTargets,
  summarizeFailures,
  type PingEventInput,
  type PingEventReport,
  type PingEventView,
} from './ping-event-rules'

export * from './ping-event-rules'

let lastPruneAt = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Facility bound to a discovery client id (System.config.client.id), if any. */
export async function findSystemForClient(clientId: string): Promise<{ id: string; name: string } | null> {
  if (!clientId) return null
  const candidates = await prisma.system.findMany({
    where: { isActive: true, config: { contains: clientId } },
    select: { id: true, name: true, config: true },
  })
  for (const system of candidates) {
    try {
      const parsed = JSON.parse(system.config ?? '') as unknown
      if (isRecord(parsed) && isRecord(parsed.client) && parsed.client.id === clientId) {
        return { id: system.id, name: system.name }
      }
    } catch {
      // not JSON
    }
  }
  return null
}

export interface StoreResult {
  system: { id: string; name: string } | null
  inserted: number
  /** Newest inserted event that was a failure (drives the alarm value update). */
  newestFailure: PingEventInput | null
}

/** Persist a report (deduped per client/address/time/status) and prune old rows. */
export async function storePingEvents(report: PingEventReport): Promise<StoreResult> {
  const system = await findSystemForClient(report.clientId)
  let inserted = 0
  let newestFailure: PingEventInput | null = null
  for (const event of report.events) {
    const key = { clientId: report.clientId, address: event.address, occurredAt: event.occurredAt, status: event.status }
    const existing = await prisma.pingEvent.findUnique({ where: { clientId_address_occurredAt_status: key }, select: { id: true } })
    if (existing) continue
    await prisma.pingEvent.create({
      data: {
        ...key,
        clientName: report.clientName,
        systemId: system?.id ?? null,
        targetName: event.targetName,
        rttMs: event.rttMs,
        sent: event.sent,
        lost: event.lost,
        consecutiveFailures: event.consecutiveFailures,
      },
    })
    inserted++
    if (event.status === '장애 발생' && (!newestFailure || event.occurredAt > newestFailure.occurredAt)) newestFailure = event
  }
  const now = Date.now()
  if (now - lastPruneAt > 60 * 60_000) {
    lastPruneAt = now
    await prisma.pingEvent.deleteMany({ where: { receivedAt: { lt: new Date(now - PING_EVENT_RETENTION_DAYS * 86_400_000) } } })
  }
  return { system, inserted, newestFailure }
}

/** Recent events for one facility, newest first. */
export async function listPingEvents(systemId: string, limit = 100): Promise<PingEventView[]> {
  const rows = await prisma.pingEvent.findMany({
    where: { systemId },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 500),
  })
  return rows.map(row => ({ ...row, occurredAt: row.occurredAt.toISOString(), receivedAt: row.receivedAt.toISOString() }))
}

/**
 * Text for a PING_FAIL alarm on `systemId`: every target still failed according to
 * events from the last few minutes, or null when nothing recent explains the alarm.
 */
export async function currentFailureSummary(systemId: string, now = new Date()): Promise<string | null> {
  const rows = await prisma.pingEvent.findMany({
    where: { systemId, occurredAt: { gte: new Date(now.getTime() - PING_FAILURE_MATCH_WINDOW_MS) } },
    orderBy: { occurredAt: 'asc' },
    take: 500,
  })
  const failed = currentlyFailedTargets(rows)
  return failed.length > 0 ? summarizeFailures(failed) : null
}

/**
 * Write the failure summary into the open critical alarm (and its log row) of the
 * facility so the dashboard card shows which target failed. Returns the alarm id
 * whose value changed, or null when there is no open critical alarm yet (the
 * worker then attaches the summary when it raises the alarm).
 */
export async function attachFailureSummaryToAlarm(systemId: string, summary: string): Promise<string | null> {
  const alarm = await prisma.alarm.findFirst({
    where: { systemId, severity: 'critical', resolvedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, value: true, message: true, createdAt: true },
  })
  if (!alarm) return null
  if (alarm.value === summary) return alarm.id
  await prisma.alarm.update({ where: { id: alarm.id }, data: { value: summary } })
  const log = await prisma.alarmLog.findFirst({
    where: { systemId, severity: 'critical', message: alarm.message, createdAt: { gte: alarm.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (log) await prisma.alarmLog.update({ where: { id: log.id }, data: { value: summary } })
  return alarm.id
}
