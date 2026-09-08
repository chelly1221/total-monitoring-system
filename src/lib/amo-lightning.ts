import { distanceKm, LIGHTNING_LOOKBACK_MS, LIGHTNING_RADIUS_KM, strikeKey, type NearbyStrike } from './lightning-rules'

// This is the public map request made by the AMO lightning web page, not APIhub.
// https://global.amo.go.kr/_js/wgis/kmap/kmap-wrap-v2.js (KMAP_layers.lgt)
// https://global.amo.go.kr/_js/common.js (getWgisBaseUrl)
export const AMO_LIGHTNING_URL = 'https://www.weather.go.kr/wgis-nuri/lgt?date=&dateNum=144&interval=10'
export const AMO_MAX_DATA_AGE_MS = 25 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const MIN_REQUEST_INTERVAL_MS = 60_000

export interface LightningObservation {
  observedAt: string
  strikes: NearbyStrike[]
}

export function parseWebUtc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return NaN
  const calendar = Date.parse(`${value.slice(0, 19)}Z`)
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN
  // The website explicitly interprets zone-less map dates as UTC (Etc/GMT).
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
}

function coordinate(value: unknown, limit: number): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : NaN
}

export function parseAmoLightning(body: unknown, now = Date.now()): LightningObservation {
  if (!body || typeof body !== 'object') throw new Error('항공기상청 낙뢰 조회 응답 형식 오류')
  const { baseDateList, lgtList } = body as Record<string, unknown>
  if (!Array.isArray(baseDateList) || !baseDateList.length || !Array.isArray(lgtList)) {
    throw new Error('항공기상청 낙뢰 조회 응답 형식 오류')
  }
  const dates = baseDateList.map(parseWebUtc)
  if (dates.some(date => !Number.isFinite(date))) throw new Error('항공기상청 낙뢰 자료시각 오류')
  const newest = Math.max(...dates)
  if (newest > now + 5 * 60_000 || now - newest > AMO_MAX_DATA_AGE_MS) {
    throw new Error('항공기상청 낙뢰 자료 갱신 지연')
  }
  const strikes = new Map<string, NearbyStrike>()
  for (const raw of lgtList) {
    if (!raw || typeof raw !== 'object') throw new Error('항공기상청 낙뢰 항목 형식 오류')
    const row = raw as Record<string, unknown>
    // KMA type 1 = cloud-to-ground, type 2 = cloud-to-cloud.
    if (row.type === '2' || row.type === 2) continue
    if (row.type !== '1' && row.type !== 1) throw new Error('항공기상청 낙뢰 종류 형식 오류')
    const lat = coordinate(row.lat, 90)
    const lon = coordinate(row.lon, 180)
    const detectedAt = parseWebUtc(row.date)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(detectedAt)) {
      throw new Error('항공기상청 낙뢰 위치·발생시각 오류')
    }
    if (detectedAt > now || detectedAt < now - LIGHTNING_LOOKBACK_MS) continue
    const distance = distanceKm(lat, lon)
    // Do not round before comparing with the radius.
    if (distance > LIGHTNING_RADIUS_KM) continue
    const strike: NearbyStrike = { detectedAt, distanceKm: distance, lat, lon, confirmed: false }
    strikes.set(strikeKey(strike), strike)
  }
  return { observedAt: new Date(newest).toISOString(), strikes: [...strikes.values()].sort((a, b) => a.detectedAt - b.detectedAt) }
}

let lastRequest = -Infinity
let request: Promise<LightningObservation> | null = null

export function fetchAmoLightning(): Promise<LightningObservation> {
  // Toggles and overlapping polls share a request, including failed attempts.
  if (request && Date.now() - lastRequest < MIN_REQUEST_INTERVAL_MS) return request
  lastRequest = Date.now()
  request = (async () => {
    const response = await fetch(AMO_LIGHTNING_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`항공기상청 낙뢰 조회 실패 (HTTP ${response.status})`)
    return parseAmoLightning(await response.json())
  })()
  return request
}
