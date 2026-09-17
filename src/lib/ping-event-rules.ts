// Pure rules for failure / recovery events pushed by 네트워크 ping 감시 clients.
// No Node imports: shared by the API route, the worker, the UI and the tests.

export const PING_EVENT_FAIL = '장애 발생'
export const PING_EVENT_RECOVER = '정상 복구'
export type PingEventStatus = typeof PING_EVENT_FAIL | typeof PING_EVENT_RECOVER

/** Events per report the server accepts (the client batches its backlog). */
export const MAX_PING_EVENTS_PER_REPORT = 200
/** Events older than this are dropped on the next report. */
export const PING_EVENT_RETENTION_DAYS = 90
/** A failure this recent explains a PING_FAIL alarm raised now. */
export const PING_FAILURE_MATCH_WINDOW_MS = 10 * 60_000

export interface PingEventInput {
  occurredAt: Date
  targetName: string
  address: string
  status: PingEventStatus
  rttMs: number | null
  sent: number
  lost: number
  consecutiveFailures: number
}

export interface PingEventReport {
  clientId: string
  clientName: string
  host: string
  events: PingEventInput[]
}

/** Row shape returned to the UI. */
export interface PingEventView {
  id: string
  clientId: string
  clientName: string
  systemId: string | null
  targetName: string
  address: string
  status: string
  rttMs: number | null
  sent: number
  lost: number
  consecutiveFailures: number
  occurredAt: string
  receivedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Parse one event as sent by the client (`at` in epoch ms); null when unusable. */
export function parsePingEvent(raw: unknown): PingEventInput | null {
  if (!isRecord(raw)) return null
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? Math.floor(raw.at) : NaN
  if (!Number.isInteger(at) || at <= 0) return null
  const status = raw.status
  if (status !== PING_EVENT_FAIL && status !== PING_EVENT_RECOVER) return null
  const address = text(raw.address, 253)
  if (!address) return null
  return {
    occurredAt: new Date(at),
    targetName: text(raw.name, 100) || address,
    address,
    status,
    rttMs: typeof raw.rttMs === 'number' && Number.isFinite(raw.rttMs) && raw.rttMs >= 0 ? Math.floor(raw.rttMs) : null,
    sent: count(raw.sent),
    lost: count(raw.lost),
    consecutiveFailures: count(raw.consecutiveFailures),
  }
}

/** Parse a client report; null when the envelope is malformed. Bad events are skipped. */
export function parsePingEventReport(body: unknown): PingEventReport | null {
  if (!isRecord(body)) return null
  const clientId = text(body.id, 64)
  if (!clientId || !Array.isArray(body.events)) return null
  const events = body.events.slice(0, MAX_PING_EVENTS_PER_REPORT).map(parsePingEvent).filter((e): e is PingEventInput => e !== null)
  return {
    clientId,
    clientName: text(body.name, 64),
    host: text(body.host, 64),
    events,
  }
}

/** One-line Korean summary shown in the alarm value, e.g. "1레이더 스위치 192.168.0.5 응답 없음 (3회 연속)". */
export interface PingEventSummaryInput {
  targetName: string
  address: string
  status: string
  consecutiveFailures: number
  rttMs: number | null
}

export function describePingEvent(event: PingEventSummaryInput): string {
  const target = event.targetName && event.targetName !== event.address ? `${event.targetName} ${event.address}` : event.address
  if (event.status === PING_EVENT_FAIL) {
    const streak = event.consecutiveFailures > 1 ? ` (${event.consecutiveFailures}회 연속)` : ''
    return `${target} 응답 없음${streak}`
  }
  const rtt = event.rttMs !== null ? ` (${event.rttMs}ms)` : ''
  return `${target} 응답 복구${rtt}`
}

/** Alarm value listing every target currently failed, newest first, bounded for the card. */
export function summarizeFailures(failures: PingEventSummaryInput[]): string {
  const lines = failures.map(describePingEvent)
  if (lines.length <= 3) return lines.join(', ')
  return `${lines.slice(0, 3).join(', ')} 외 ${lines.length - 3}건`
}

/**
 * Targets still failed after replaying events oldest → newest: a target is failed
 * from its last 장애 발생 until a later 정상 복구 for the same address.
 */
export function currentlyFailedTargets<T extends { address: string; status: string; occurredAt: Date }>(events: T[]): T[] {
  const latest = new Map<string, T>()
  for (const event of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    latest.set(event.address, event)
  }
  return [...latest.values()].filter(e => e.status === PING_EVENT_FAIL).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
}
