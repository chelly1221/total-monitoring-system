// WING(wing15.lovable.app) 뇌전 감시 연동 — Supabase REST 클라이언트.
// 워커의 1분 폴러와 Next.js API 라우트가 공유한다 (서버 전용).
//
// 데이터 모델 (wing15 Supabase):
// - weather_warnings: 공항 기상특보. wrng_type '5' = 뇌전(뇌우)특보,
//   valid_tm1/valid_tm2 = 발효 시작/종료, extension_* = 연장/해제 정보.
// - events: event_type 'lightning'(개별 낙뢰, lightning_info에 distance_km 등)
//   또는 'warning'(특보 이벤트, 현장확인의 대상).
// - inspection_status: 현장별 확인 상태. (event_id, user_id, is_inspected).
//   TX 계정(송신소)으로 인증해 쓰면 wing15의 "현장별 확인 현황"에서
//   송신소 항목이 확인됨으로 표시된다.

import type { Wing15Checklist, Wing15Item, Wing15State } from '@/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('wing15')

const SUPABASE_URL = 'https://bwckbsugyojylfyqivrj.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3Y2tic3VneW9qeWxmeXFpdnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxOTMzNjcsImV4cCI6MjA3NTc2OTM2N30.1nr0PgjRHcU3lowjanJ8_XNnCeVYxbpwfQWFTf3-MsQ'
// 로그인 계정 (wing15는 `${아이디}@lightning-system.local` 형식의 이메일로 인증)
const WING_USERNAME = 'TX'
const WING_PASSWORD = '123456'

const AIRPORT_CODE = 'RKSS'
const AIRPORT_NAME = '김포공항'
const RADIUS_KM = 5
const LIGHTNING_WRNG_TYPE = '5'
// 이 시간 내의 특보/낙뢰만 미확인 알림 대상으로 유지
const LOOKBACK_MS =
  (parseInt(process.env.WING15_LOOKBACK_HOURS || '24', 10) || 24) * 60 * 60 * 1000
// 마지막 낙뢰 후 이 시간 동안은 확인 후에도 낙뢰 항목을 계속 표시
const STRIKE_ACTIVE_MS = 60 * 60 * 1000
const REST_TIMEOUT_MS = 15_000
// 수집 함수는 기상청 API를 호출하므로 여유 있게
const EDGE_TIMEOUT_MS = 25_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WeatherWarningRow {
  id: string
  icao_code: string
  airport_name: string
  tm: string
  wrng_type: string
  valid_tm1: string
  valid_tm2: string
  wrng_msg: string
  extension_type: string | null
  extension_start_utc: string | null
  extension_end_utc: string | null
}

interface LightningEventRow {
  id: string
  lightning_info: {
    detectedAt?: string
    distance_km?: number | string
    type?: string
    airport_code?: string
    strength?: number
  } | null
}

interface InspectionRow {
  id: string
  event_id: string
  is_inspected: boolean
}

interface Wing15Raw {
  userId: string
  warnings: WeatherWarningRow[]
  strikes: { id: string; detectedAt: number }[]
  warningEvents: Map<string, string> // warning_id -> event_id
  inspections: Map<string, InspectionRow> // event_id -> row
}

// ---------------------------------------------------------------------------
// 인증
// ---------------------------------------------------------------------------

let auth: { token: string; userId: string; expiresAt: number } | null = null

async function login(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${WING_USERNAME}@lightning-system.local`,
      password: WING_PASSWORD,
    }),
    signal: AbortSignal.timeout(REST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`wing15 로그인 실패 (HTTP ${res.status})`)
  }
  const body = (await res.json()) as {
    access_token?: string
    expires_in?: number
    user?: { id?: string }
  }
  if (!body.access_token || !body.user?.id) {
    throw new Error('wing15 로그인 응답 형식 오류')
  }
  auth = {
    token: body.access_token,
    userId: body.user.id,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
  return auth
}

async function getAuth(): Promise<{ token: string; userId: string }> {
  if (auth && Date.now() < auth.expiresAt - 120_000) return auth
  return login()
}

// ---------------------------------------------------------------------------
// HTTP 헬퍼
// ---------------------------------------------------------------------------

interface RestInit {
  method?: string
  body?: unknown
  prefer?: string
}

async function rest<T>(
  path: string,
  params: Record<string, string>,
  init: RestInit = {}
): Promise<T> {
  const doFetch = async (token: string): Promise<Response> => {
    const qs = new URLSearchParams(params).toString()
    return fetch(`${SUPABASE_URL}${path}${qs ? `?${qs}` : ''}`, {
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
  }

  let { token } = await getAuth()
  let res = await doFetch(token)
  if (res.status === 401) {
    // 토큰 만료/폐기 — 재로그인 후 1회 재시도
    auth = null
    token = (await login()).token
    res = await doFetch(token)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`wing15 API 오류 (HTTP ${res.status}) ${path}: ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function invokeEdgeFunction(name: string, body: unknown): Promise<void> {
  const { token } = await getAuth()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`${name} 호출 실패 (HTTP ${res.status})`)
  }
}

// ---------------------------------------------------------------------------
// 수집 트리거 — wing15의 데이터는 클라이언트가 수집 함수를 호출해야 갱신되므로
// 폴링 시 직접 호출해 최신 상태를 보장한다 (실패해도 기존 DB 데이터로 진행).
// ---------------------------------------------------------------------------

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function refreshCollections(): Promise<void> {
  const jobs: Promise<void>[] = [
    invokeEdgeFunction('fetch-weather-warnings', {}),
    invokeEdgeFunction('fetch-lightning-data', {
      startDate: kstDateStr(),
      range: 10,
      airport: AIRPORT_CODE,
    }),
  ]
  // KST 자정 직후에는 전일 데이터도 함께 갱신 (날짜 경계 낙뢰 누락 방지)
  if (new Date(Date.now() + 9 * 3600_000).getUTCHours() === 0) {
    jobs.push(
      invokeEdgeFunction('fetch-lightning-data', {
        startDate: kstDateStr(-1),
        range: 10,
        airport: AIRPORT_CODE,
      })
    )
  }
  const results = await Promise.allSettled(jobs)
  for (const r of results) {
    if (r.status === 'rejected') {
      log.warn('수집 함수 호출 실패:', r.reason instanceof Error ? r.reason.message : r.reason)
    }
  }
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

// 해제/연장 반영한 실효 종료 시각 (wing15 앱과 동일한 규칙)
function effectiveEnd(w: WeatherWarningRow): number {
  if (
    (w.extension_type === '해제' || w.extension_type === '연장') &&
    w.extension_end_utc
  ) {
    return new Date(w.extension_end_utc).getTime()
  }
  return new Date(w.valid_tm2).getTime()
}

// 발효 시작 전에 해제된 특보 (wing15에서 "무효" 표시) — 확인 대상 아님
function isVoided(w: WeatherWarningRow): boolean {
  return (
    w.extension_type === '해제' &&
    !!w.extension_start_utc &&
    new Date(w.extension_start_utc).getTime() <= new Date(w.valid_tm1).getTime()
  )
}

async function fetchRaw(): Promise<Wing15Raw> {
  const { userId } = await getAuth()
  const now = Date.now()
  const sinceIso = new Date(now - LOOKBACK_MS).toISOString()

  const [warningRows, strikeRows] = await Promise.all([
    rest<WeatherWarningRow[]>('/rest/v1/weather_warnings', {
      icao_code: `eq.${AIRPORT_CODE}`,
      wrng_type: `eq.${LIGHTNING_WRNG_TYPE}`,
      order: 'created_at.desc',
      limit: '30',
    }),
    rest<LightningEventRow[]>('/rest/v1/events', {
      event_type: 'eq.lightning',
      'lightning_info->>airport_code': `eq.${AIRPORT_CODE}`,
      'lightning_info->>detectedAt': `gte.${sinceIso}`,
      select: 'id,lightning_info',
      limit: '1000',
    }),
  ])

  const warnings = warningRows.filter(
    (w) => !isVoided(w) && effectiveEnd(w) >= now - LOOKBACK_MS
  )

  // wing15와 동일 조건: 반경 5km 이내 + 지상낙뢰(type 'G') + DB에 저장된 이벤트만
  const strikes = strikeRows
    .filter((row) => {
      const info = row.lightning_info
      if (!info || !UUID_RE.test(row.id)) return false
      const dist = Number(info.distance_km)
      if (isNaN(dist) || dist > RADIUS_KM) return false
      if (info.type !== 'G') return false
      const t = info.detectedAt ? new Date(info.detectedAt).getTime() : NaN
      return !isNaN(t)
    })
    .map((row) => ({
      id: row.id,
      detectedAt: new Date(row.lightning_info!.detectedAt!).getTime(),
    }))
    .sort((a, b) => a.detectedAt - b.detectedAt)

  const warningEvents = new Map<string, string>()
  if (warnings.length > 0) {
    const rows = await rest<{ id: string; warning_info: { warning_id?: string } | null }[]>(
      '/rest/v1/events',
      {
        event_type: 'eq.warning',
        'warning_info->>warning_id': `in.(${warnings.map((w) => w.id).join(',')})`,
        select: 'id,warning_info',
      }
    )
    for (const row of rows) {
      if (row.warning_info?.warning_id) warningEvents.set(row.warning_info.warning_id, row.id)
    }
  }

  const inspections = new Map<string, InspectionRow>()
  const eventIds = [...strikes.map((s) => s.id), ...warningEvents.values()]
  if (eventIds.length > 0) {
    const rows = await rest<InspectionRow[]>('/rest/v1/inspection_status', {
      user_id: `eq.${userId}`,
      event_id: `in.(${eventIds.join(',')})`,
      select: 'id,event_id,is_inspected',
    })
    for (const row of rows) inspections.set(row.event_id, row)
  }

  return { userId, warnings, strikes, warningEvents, inspections }
}

// ---------------------------------------------------------------------------
// 상태 계산
// ---------------------------------------------------------------------------

function computeItems(raw: Wing15Raw): Wing15Item[] {
  const now = Date.now()
  const items: Wing15Item[] = []

  for (const w of raw.warnings) {
    const eventId = raw.warningEvents.get(w.id)
    const confirmed = eventId ? (raw.inspections.get(eventId)?.is_inspected ?? false) : false
    const end = effectiveEnd(w)
    const cancelled = w.extension_type === '해제'
    // 발효 중이거나(예고 포함) 종료 후 미확인이면 유지, 확인된 지난 특보는 제외
    if (end < now && confirmed) continue
    items.push({
      key: `warning:${w.id}`,
      kind: 'warning',
      title: '뇌전특보',
      startAt: w.valid_tm1,
      endAt: new Date(end).toISOString(),
      active: end >= now && !cancelled,
      cancelled,
      confirmed,
    })
  }

  if (raw.strikes.length > 0) {
    const first = raw.strikes[0]
    const last = raw.strikes[raw.strikes.length - 1]
    const confirmed = raw.strikes.every(
      (s) => raw.inspections.get(s.id)?.is_inspected ?? false
    )
    const active = last.detectedAt >= now - STRIKE_ACTIVE_MS
    // 확인 완료 + 최근 낙뢰 없음이면 표시하지 않음
    if (!confirmed || active) {
      items.push({
        key: 'strikes:RKSS',
        kind: 'strikes',
        title: `낙뢰 ${raw.strikes.length}건`,
        startAt: new Date(first.detectedAt).toISOString(),
        endAt: new Date(last.detectedAt).toISOString(),
        active,
        strikeCount: raw.strikes.length,
        confirmed,
      })
    }
  }

  return items
}

function computeSig(items: Wing15Item[]): string {
  return items
    .filter((i) => !i.confirmed)
    .map((i) => i.key)
    .sort()
    .join('|')
}

function buildState(items: Wing15Item[], checklist: Wing15Checklist | null): Wing15State {
  const sig = computeSig(items)
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    sig,
    items,
    // 미확인 알림 구성이 바뀌면 기존 체크는 무효 (새 점검 필요)
    checklist:
      checklist && checklist.sig === sig
        ? checklist
        : { special: false, maintenance: false, sig },
  }
}

/**
 * wing15 데이터 수집을 갱신하고 현재 뇌전 감시 상태를 계산한다. (워커 폴러용)
 */
export async function getWing15Status(
  checklist: Wing15Checklist | null
): Promise<Wing15State> {
  await refreshCollections()
  const raw = await fetchRaw()
  return buildState(computeItems(raw), checklist)
}

// ---------------------------------------------------------------------------
// 현장 확인 (송신소 = TX 계정)
// ---------------------------------------------------------------------------

/**
 * 현재 미확인 뇌전 알림 전부를 TX(송신소) 계정으로 확인 처리한다.
 * wing15의 "현장별 확인 현황"에서 송신소가 확인됨으로 바뀐다.
 * 확인 후의 최신 상태를 반환한다.
 */
export async function confirmAsTx(): Promise<Wing15State> {
  const raw = await fetchRaw()
  const nowIso = new Date().toISOString()

  // 특보는 이벤트 행이 지연 생성되므로 없으면 만든다 (wing15 앱과 동일 패턴)
  for (const w of raw.warnings) {
    if (raw.warningEvents.has(w.id)) continue
    const rows = await rest<{ id: string }[]>(
      '/rest/v1/events',
      {},
      {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          event_type: 'warning',
          title: `${w.airport_name || AIRPORT_NAME} 뇌전 특보`,
          description: w.wrng_msg,
          warning_info: {
            warning_id: w.id,
            icao_code: w.icao_code,
            airport_name: w.airport_name,
            wrng_type: w.wrng_type,
            valid_tm1: w.valid_tm1,
            valid_tm2: w.valid_tm2,
          },
        },
      }
    )
    if (rows?.[0]?.id) raw.warningEvents.set(w.id, rows[0].id)
  }

  const eventIds = [...raw.strikes.map((s) => s.id), ...raw.warningEvents.values()]
  const toInsert = eventIds.filter((id) => !raw.inspections.has(id))
  const toUpdate = [...raw.inspections.values()].filter((r) => !r.is_inspected)

  if (toInsert.length > 0) {
    await rest(
      '/rest/v1/inspection_status',
      {},
      {
        method: 'POST',
        prefer: 'return=minimal',
        body: toInsert.map((eventId) => ({
          event_id: eventId,
          user_id: raw.userId,
          is_inspected: true,
          inspected_at: nowIso,
        })),
      }
    )
  }
  for (const row of toUpdate) {
    await rest(
      '/rest/v1/inspection_status',
      { id: `eq.${row.id}` },
      {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { is_inspected: true, inspected_at: nowIso },
      }
    )
  }

  log.info(
    `현장 확인 완료 (송신소): 신규 ${toInsert.length}건, 갱신 ${toUpdate.length}건`
  )

  // 확인 반영된 최신 상태 재조회
  const fresh = await fetchRaw()
  return buildState(computeItems(fresh), null)
}
