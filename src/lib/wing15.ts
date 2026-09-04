// WING(wing15.lovable.app) 뇌전 감시 연동 — 읽기 전용 낙뢰 피드 클라이언트.
// 워커의 폴러와 Next.js API 라우트가 공유한다 (서버 전용).
//
// 2026-09-04 wing15 개발자 안내에 따라 연동 방식을 바꿨다:
// - 기존 방식(TX 계정 로그인 → 수집 함수 호출 → events/weather_warnings/
//   inspection_status 조회·기록)은 서버 부하 문제로 wing15 측에서 막았다.
//   로그인 계정은 더 이상 쓰지 않는다.
// - 대신 익명 키만으로 읽는 `lightning_feed` 뷰(김포공항 낙뢰 최신 N건)를 조회한다.
//   응답 항목: airport_code, detected_at, type('G'=지상낙뢰, 그 외 공중낙뢰), distance_km
// - 호출은 최대 1분당 1회로 제한 요청받음 (TMS 폴러는 3분 주기).
// - 뇌전특보는 피드에 없으므로 제공하지 않는다.
// - 피드가 최신 N건만 주므로 폴링마다 받은 낙뢰를 로컬 이력(Setting `wing15Strikes`)에
//   누적하고, 이력을 기준으로 경보 상태를 계산한다.
// - 현장 확인(송신소=TX 계정 → inspection_status 기록)은 주기 폴링에서는 하지 않고,
//   사용자가 확인 버튼을 누를 때만 접속해 한 번 기록한다 (`confirmOnWing15`).
//   확인 시각은 TMS 로컬(Setting `wing15ConfirmedAt`)에도 남긴다.

import type { Wing15Checklist, Wing15Item, Wing15State } from '@/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('wing15')

const SUPABASE_URL = 'https://bwckbsugyojylfyqivrj.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3Y2tic3VneW9qeWxmeXFpdnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxOTMzNjcsImV4cCI6MjA3NTc2OTM2N30.1nr0PgjRHcU3lowjanJ8_XNnCeVYxbpwfQWFTf3-MsQ'

const AIRPORT_CODE = 'RKSS'
const RADIUS_KM = 5
const GROUND_STRIKE_TYPE = 'G'
// 피드 조회 건수 — wing15 개발자가 제공한 주소 기준 5건. 늘리려면 개발자와 협의 후 env로 조정
const FEED_LIMIT = parseInt(process.env.WING15_FEED_LIMIT || '5', 10) || 5
// 이 시간 내의 낙뢰만 이력에 유지하고 미확인 알림 대상으로 삼는다
const LOOKBACK_MS =
  (parseInt(process.env.WING15_LOOKBACK_HOURS || '24', 10) || 24) * 60 * 60 * 1000
// 마지막 낙뢰 후 이 시간 동안은 "발효 중"으로 보고, 확인 후에도 낙뢰 항목을 계속 표시
const STRIKE_ACTIVE_MS = 60 * 60 * 1000
const REST_TIMEOUT_MS = 15_000

interface LightningFeedRow {
  airport_code: string
  detected_at: string
  type: string
  distance_km: number | string
}

/** 반경 내 지상낙뢰 1건 (로컬 이력에 저장되는 형태) */
export interface Wing15Strike {
  detectedAt: number // epoch ms (UTC)
  distanceKm: number
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

/**
 * wing15 낙뢰 피드에서 최신 N건을 받아 경보 조건(반경 5km 이내 + 지상낙뢰)에 맞는
 * 것만 돌려준다. 판정 규칙은 wing15 앱과 동일.
 */
export async function fetchNearbyStrikes(): Promise<Wing15Strike[]> {
  const qs = new URLSearchParams({
    select: '*',
    airport_code: `eq.${AIRPORT_CODE}`,
    order: 'detected_at.desc',
    limit: String(FEED_LIMIT),
  })
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lightning_feed?${qs.toString()}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal: AbortSignal.timeout(REST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`wing15 낙뢰 피드 오류 (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const rows = (await res.json()) as unknown
  if (!Array.isArray(rows)) throw new Error('wing15 낙뢰 피드 응답 형식 오류')

  return (rows as LightningFeedRow[]).flatMap((row) => {
    if (row.airport_code !== AIRPORT_CODE || row.type !== GROUND_STRIKE_TYPE) return []
    const dist = Number(row.distance_km)
    const t = new Date(row.detected_at).getTime()
    if (isNaN(dist) || dist > RADIUS_KM || isNaN(t)) return []
    return [{ detectedAt: t, distanceKm: dist }]
  })
}

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
        typeof (s as Wing15Strike).detectedAt === 'number' &&
        typeof (s as Wing15Strike).distanceKm === 'number'
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
  const byKey = new Map<string, Wing15Strike>()
  for (const s of [...history, ...incoming]) {
    if (s.detectedAt < since) continue
    byKey.set(`${s.detectedAt}:${s.distanceKm}`, s)
  }
  return [...byKey.values()].sort((a, b) => a.detectedAt - b.detectedAt)
}

// ---------------------------------------------------------------------------
// 상태 계산
// ---------------------------------------------------------------------------

function computeItems(
  strikes: Wing15Strike[],
  confirmedAt: number | null,
  now: number
): Wing15Item[] {
  const recent = strikes
    .filter((s) => s.detectedAt >= now - LOOKBACK_MS)
    .sort((a, b) => a.detectedAt - b.detectedAt)
  if (recent.length === 0) return []

  const first = recent[0]
  const last = recent[recent.length - 1]
  // 확인 시각 이후 낙뢰가 없으면 확인된 것으로 본다
  const confirmed = confirmedAt !== null && last.detectedAt <= confirmedAt
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

function computeSig(items: Wing15Item[]): string {
  return items
    .filter((i) => !i.confirmed)
    .map((i) => i.key)
    .sort()
    .join('|')
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
  const sig = computeSig(items)
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
// 주기 폴링은 위의 익명 피드만 쓰고, 이 경로는 버튼을 누를 때 한 번씩
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

/**
 * 유지 기간 내 반경 5km 지상낙뢰 이벤트 전부를 TX(송신소) 계정으로 wing15에
 * 확인 처리한다. 확인 버튼 클릭 시에만 호출할 것 (주기 실행 금지).
 */
export async function confirmOnWing15(now = Date.now()): Promise<Wing15ConfirmResult> {
  const { token, userId } = await loginAsTx()
  const sinceIso = new Date(now - LOOKBACK_MS).toISOString()

  const rows = await restAsTx<LightningEventRow[]>(token, '/rest/v1/events', {
    event_type: 'eq.lightning',
    'lightning_info->>airport_code': `eq.${AIRPORT_CODE}`,
    'lightning_info->>detectedAt': `gte.${sinceIso}`,
    select: 'id,lightning_info',
    limit: '1000',
  })
  // 피드/경보와 동일 조건: 반경 5km 이내 + 지상낙뢰 + DB에 저장된(uuid) 이벤트만
  const eventIds = rows
    .filter((row) => {
      const info = row.lightning_info
      if (!info || !UUID_RE.test(row.id)) return false
      if (info.type !== GROUND_STRIKE_TYPE) return false
      const dist = Number(info.distance_km)
      return !isNaN(dist) && dist <= RADIUS_KM
    })
    .map((row) => row.id)

  const result: Wing15ConfirmResult = { total: eventIds.length, inserted: 0, updated: 0 }
  if (eventIds.length === 0) {
    log.info('현장 확인 (송신소): 대상 낙뢰 이벤트 없음')
    return result
  }

  const existing = await restAsTx<InspectionRow[]>(token, '/rest/v1/inspection_status', {
    user_id: `eq.${userId}`,
    event_id: `in.(${eventIds.join(',')})`,
    select: 'id,event_id,is_inspected',
  })
  const byEvent = new Map(existing.map((r) => [r.event_id, r]))
  const toInsert = eventIds.filter((id) => !byEvent.has(id))
  const toUpdate = existing.filter((r) => !r.is_inspected).map((r) => r.id)
  const nowIso = new Date(now).toISOString()

  if (toInsert.length > 0) {
    await restAsTx(
      token,
      '/rest/v1/inspection_status',
      {},
      {
        method: 'POST',
        prefer: 'return=minimal',
        body: toInsert.map((eventId) => ({
          event_id: eventId,
          user_id: userId,
          is_inspected: true,
          inspected_at: nowIso,
        })),
      }
    )
    result.inserted = toInsert.length
  }
  if (toUpdate.length > 0) {
    await restAsTx(
      token,
      '/rest/v1/inspection_status',
      { id: `in.(${toUpdate.join(',')})` },
      {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_inspected: true, inspected_at: nowIso },
      }
    )
    result.updated = toUpdate.length
  }

  log.info(
    `현장 확인 완료 (송신소): 대상 ${result.total}건, 신규 ${result.inserted}건, 갱신 ${result.updated}건`
  )
  return result
}
