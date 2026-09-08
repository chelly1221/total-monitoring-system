// 낙뢰 상태·WING 현장 확인 연동. 웹 자료 수집은 amo-lightning.ts에서 수행한다.
import type { Wing15Checklist, Wing15Item, Wing15State } from '@/types'
import { createLogger } from '@/lib/logger'
import { createHash } from 'node:crypto'
import { GIMPO, LIGHTNING_RADIUS_KM, LIGHTNING_LOOKBACK_MS, LIGHTNING_ACTIVE_MS, sameStrike, strikeKey, isStrikeConfirmed, type NearbyStrike } from './lightning-rules'

const log = createLogger('wing15')

const SUPABASE_URL = 'https://bwckbsugyojylfyqivrj.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3Y2tic3VneW9qeWxmeXFpdnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxOTMzNjcsImV4cCI6MjA3NTc2OTM2N30.1nr0PgjRHcU3lowjanJ8_XNnCeVYxbpwfQWFTf3-MsQ'

const AIRPORT_CODE = GIMPO.code
const RADIUS_KM = LIGHTNING_RADIUS_KM
const GROUND_STRIKE_TYPE = 'G'
const LOOKBACK_MS = LIGHTNING_LOOKBACK_MS
const STRIKE_ACTIVE_MS = LIGHTNING_ACTIVE_MS
const REST_TIMEOUT_MS = 15_000

export type Wing15Strike = NearbyStrike

// ---------------------------------------------------------------------------
// 로컬 이력
// ---------------------------------------------------------------------------

/** Setting에 저장된 이력 JSON 파싱 (손상/미설정이면 빈 배열) */
export function parseStrikes(json: string | null | undefined): Wing15Strike[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is Wing15Strike =>
        typeof s === 'object' &&
        s !== null &&
        Number.isFinite((s as Wing15Strike).detectedAt) &&
        Number.isFinite((s as Wing15Strike).distanceKm) &&
        (s as Wing15Strike).distanceKm >= 0 && (s as Wing15Strike).distanceKm <= RADIUS_KM &&
        ((s as Wing15Strike).confirmed === undefined || typeof (s as Wing15Strike).confirmed === 'boolean') &&
        ((s as Wing15Strike).lat === undefined && (s as Wing15Strike).lon === undefined ||
          Number.isFinite((s as Wing15Strike).lat) && Math.abs((s as Wing15Strike).lat!) <= 90 &&
          Number.isFinite((s as Wing15Strike).lon) && Math.abs((s as Wing15Strike).lon!) <= 180)
    )
  } catch {
    return []
  }
}

/** 이력에 새로 받은 낙뢰를 합친다 — 중복 제거, 유지 기간 밖 제거, 시간순 정렬 */
export function mergeStrikes(
  history: Wing15Strike[],
  incoming: Wing15Strike[],
  now = Date.now()
): Wing15Strike[] {
  const since = now - LOOKBACK_MS
  const byTime = new Map<number, Wing15Strike[]>()
  for (const s of [...history, ...incoming]) {
    if (!Number.isFinite(s.detectedAt) || s.detectedAt < since || s.detectedAt > now ||
      !Number.isFinite(s.distanceKm) || s.distanceKm < 0 || s.distanceKm > RADIUS_KM) continue
    const time = Math.floor(s.detectedAt / 1000)
    const group = byTime.get(time) ?? []
    const index = group.findIndex(previous => sameStrike(previous, s))
    if (index === -1) group.push({ ...s })
    else {
      const previous = group[index]
      group[index] = { ...previous, ...s, ...(previous.confirmed !== undefined ? { confirmed: previous.confirmed } : {}) }
    }
    byTime.set(time, group)
  }
  return [...byTime.values()].flat().sort((a, b) => a.detectedAt - b.detectedAt || strikeKey(a).localeCompare(strikeKey(b)))
}

// ---------------------------------------------------------------------------
// 상태 계산
// ---------------------------------------------------------------------------

function computeItems(
  strikes: Wing15Strike[],
  confirmedAt: number | null,
  now: number
): Wing15Item[] {
  const recent = mergeStrikes(strikes, [], now)
  if (recent.length === 0) return []

  const first = recent[0]
  const last = recent[recent.length - 1]
  // New web observations are confirmed individually, including late arrivals.
  const confirmed = recent.every(strike => isStrikeConfirmed(strike, confirmedAt))
  const active = last.detectedAt >= now - STRIKE_ACTIVE_MS
  // 확인 완료 + 최근 낙뢰 없음이면 표시하지 않음
  if (confirmed && !active) return []

  return [
    {
      key: 'strikes:RKSS',
      kind: 'strikes',
      title: `낙뢰 ${recent.length}건`,
      startAt: new Date(first.detectedAt).toISOString(),
      endAt: new Date(last.detectedAt).toISOString(),
      active,
      strikeCount: recent.length,
      confirmed,
    },
  ]
}

function computeSig(strikes: Wing15Strike[], confirmedAt: number | null, now: number): string {
  const keys = mergeStrikes(strikes, [], now).filter(strike => !isStrikeConfirmed(strike, confirmedAt)).map(strikeKey).sort()
  return keys.length ? `strikes:RKSS:${createHash('sha256').update(JSON.stringify(keys)).digest('hex')}` : ''
}

/**
 * 로컬 낙뢰 이력과 확인 시각으로 현재 뇌전 감시 상태를 계산한다.
 * (워커 폴러와 확인 API가 공유)
 */
export function buildWing15State(
  strikes: Wing15Strike[],
  confirmedAt: number | null,
  checklist: Wing15Checklist | null,
  now = Date.now()
): Wing15State {
  const items = computeItems(strikes, confirmedAt, now)
  const sig = computeSig(strikes, confirmedAt, now)
  return {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    sig,
    items,
    // 미확인 알림 구성이 바뀌면 기존 체크는 무효 (새 점검 필요)
    checklist:
      checklist && checklist.sig === sig
        ? checklist
        : { special: false, maintenance: false, sig },
  }
}

/** Setting `wing15ConfirmedAt` 값(ISO) → epoch ms (미설정/손상이면 null) */
export function parseConfirmedAt(value: string | null | undefined): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return isNaN(t) ? null : t
}

// ---------------------------------------------------------------------------
// 현장 확인 (송신소 = TX 계정) — 확인 버튼 클릭 시에만 접속한다.
// 주기 폴링은 항공기상청 웹 자료만 읽고, 이 경로는 버튼을 누를 때 한 번씩
// 로그인 → 반경 내 낙뢰 이벤트 조회 → inspection_status 기록만 수행한다.
// 기록하면 wing15의 "현장별 확인 현황"에서 송신소 항목이 확인됨으로 바뀐다.
// ---------------------------------------------------------------------------

// 로그인 계정 (wing15는 `${아이디}@lightning-system.local` 형식의 이메일로 인증)
const WING_USERNAME = 'TX'
const WING_PASSWORD = '123456'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LightningEventRow {
  id: string
  lightning_info: {
    detectedAt?: string
    distance_km?: number | string
    type?: string
    airport_code?: string
    lat?: number | string
    lon?: number | string
  } | null
}

interface InspectionRow {
  id: string
  event_id: string
  is_inspected: boolean
}

export interface Wing15ConfirmResult {
  /** 확인 대상 낙뢰 이벤트 수 (반경 5km 지상낙뢰, 유지 기간 내) */
  total: number
  /** 새로 기록한 확인 건수 */
  inserted: number
  /** 미확인 → 확인으로 갱신한 건수 */
  updated: number
}

export class Wing15ConfirmationPendingError extends Error {}

let confirmationInFlight = false

async function loginAsTx(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${WING_USERNAME}@lightning-system.local`,
      password: WING_PASSWORD,
    }),
    signal: AbortSignal.timeout(REST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`wing15 로그인 실패 (HTTP ${res.status})`)
  const body = (await res.json()) as { access_token?: string; user?: { id?: string } }
  if (!body.access_token || !body.user?.id) throw new Error('wing15 로그인 응답 형식 오류')
  return { token: body.access_token, userId: body.user.id }
}

interface RestInit {
  method?: string
  body?: unknown
  prefer?: string
}

async function restAsTx<T>(
  token: string,
  path: string,
  params: Record<string, string>,
  init: RestInit = {}
): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${SUPABASE_URL}${path}${qs ? `?${qs}` : ''}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(REST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`wing15 API 오류 (HTTP ${res.status}) ${path}: ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Only writes reviewed, matching WING events; never called by the poller. */
export async function confirmOnWing15(reviewed: Wing15Strike[], now = Date.now()): Promise<Wing15ConfirmResult> {
  if (!reviewed.length) throw new Wing15ConfirmationPendingError('WING 확인 대상이 없습니다')
  if (confirmationInFlight) throw new Wing15ConfirmationPendingError('WING 확인 처리 중입니다. 잠시 후 다시 확인하세요')
  confirmationInFlight = true
  try {
    return await confirmReviewedStrikes(reviewed, now)
  } finally {
    confirmationInFlight = false
  }
}

async function confirmReviewedStrikes(reviewed: Wing15Strike[], now: number): Promise<Wing15ConfirmResult> {
  const { token, userId } = await loginAsTx()
  const through = Math.max(...reviewed.map(strike => strike.detectedAt))
  const candidates: { id: string; strike: Wing15Strike }[] = []
  // Stable pagination avoids silently confirming only the first page in a storm.
  const pageSize = 200
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error('WING 낙뢰 조회 범위를 초과했습니다. 확인을 완료하지 않았습니다')
    const rows = await restAsTx<LightningEventRow[]>(token, '/rest/v1/events', {
      event_type: 'eq.lightning',
      'lightning_info->>airport_code': 'eq.' + AIRPORT_CODE,
      'lightning_info->>detectedAt': 'gte.' + new Date(now - LOOKBACK_MS).toISOString(),
      select: 'id,lightning_info', order: 'id.asc', limit: String(pageSize), offset: String(page * pageSize),
    })
    if (!Array.isArray(rows)) throw new Error('WING 낙뢰 응답 형식 오류')
    for (const row of rows) {
      const info = row?.lightning_info
      if (!info || !UUID_RE.test(row.id) || info.airport_code !== AIRPORT_CODE || info.type !== GROUND_STRIKE_TYPE) continue
      const dist = Number(info.distance_km)
      const detectedAt = Date.parse(info.detectedAt ?? '')
      if (info.distance_km == null || info.distance_km === '' || !Number.isFinite(dist) || dist < 0 || dist > RADIUS_KM ||
        !Number.isFinite(detectedAt) || detectedAt < now - LOOKBACK_MS || detectedAt > through) continue
      const strike: Wing15Strike = { detectedAt, distanceKm: dist }
      if (info.lat != null && info.lat !== '' && info.lon != null && info.lon !== '') {
        const lat = Number(info.lat), lon = Number(info.lon)
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) continue
        strike.lat = lat
        strike.lon = lon
      }
      candidates.push({ id: row.id, strike })
    }
    if (rows.length < pageSize) break
  }

  const matchedIds = new Set<string>()
  let missing = 0
  for (const strike of reviewed) {
    const matches = candidates.filter(candidate => !matchedIds.has(candidate.id) && sameStrike(strike, candidate.strike))
    if (!matches.length) missing++
    else for (const match of matches) matchedIds.add(match.id)
  }
  if (missing) {
    throw new Wing15ConfirmationPendingError('낙뢰 ' + missing + '건이 아직 WING에서 확인되지 않습니다. WING 반영 후 다시 확인하세요')
  }
  const eventIds = [...matchedIds]
  const result: Wing15ConfirmResult = { total: eventIds.length, inserted: 0, updated: 0 }
  const nowIso = new Date(now).toISOString()
  // Keep filters/URLs bounded and verify that remote writes really persisted.
  for (let offset = 0; offset < eventIds.length; offset += 100) {
    const ids = eventIds.slice(offset, offset + 100)
    const params = {
      user_id: 'eq.' + userId,
      event_id: 'in.(' + ids.join(',') + ')',
      select: 'id,event_id,is_inspected', limit: '1000',
    }
    const existing = await restAsTx<InspectionRow[]>(token, '/rest/v1/inspection_status', params)
    if (!Array.isArray(existing)) throw new Error('WING 확인 상태 응답 형식 오류')
    const byEvent = new Map(existing.map(row => [row.event_id, row]))
    const toInsert = ids.filter(id => !byEvent.has(id))
    const toUpdate = existing.filter(row => ids.includes(row.event_id) && row.is_inspected !== true).map(row => row.id)
    if (toInsert.length) {
      await restAsTx(token, '/rest/v1/inspection_status', {}, {
        method: 'POST', prefer: 'return=minimal',
        body: toInsert.map(eventId => ({ event_id: eventId, user_id: userId, is_inspected: true, inspected_at: nowIso })),
      })
      result.inserted += toInsert.length
    }
    if (toUpdate.length) {
      await restAsTx(token, '/rest/v1/inspection_status', { user_id: 'eq.' + userId, id: 'in.(' + toUpdate.join(',') + ')' }, {
        method: 'PATCH', prefer: 'return=minimal', body: { is_inspected: true, inspected_at: nowIso },
      })
      result.updated += toUpdate.length
    }
    const verified = await restAsTx<InspectionRow[]>(token, '/rest/v1/inspection_status', params)
    if (!Array.isArray(verified) || ids.some(id => !verified.some(row => row.event_id === id && row.is_inspected === true))) {
      throw new Error('WING 확인 기록이 저장되지 않았습니다. 다시 확인하세요')
    }
  }
  log.info('송신소 현장 확인 완료: 대상 ' + result.total + '건, 신규 ' + result.inserted + '건, 갱신 ' + result.updated + '건')
  return result
}
