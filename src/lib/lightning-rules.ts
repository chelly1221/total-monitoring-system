// Keep the same reference point as WING's RKSS airport configuration.
// Verified against wing15.lovable.app/assets/index-BbmuDqQ2.js, 2026-09-08.
export const GIMPO = { code: 'RKSS', lat: 37.56, lon: 126.8 } as const
export const LIGHTNING_RADIUS_KM = 5
export const LIGHTNING_ACTIVE_MS = 60 * 60_000
const configuredHours = Number(process.env.WING15_LOOKBACK_HOURS || 24)
export const LIGHTNING_LOOKBACK_MS =
  (Number.isFinite(configuredHours) && configuredHours > 0 ? Math.min(configuredHours, 24) : 24) * 3600_000

export interface NearbyStrike {
  detectedAt: number
  distanceKm: number
  lat?: number
  lon?: number
  // Undefined is reserved for old WING history that used a time watermark.
  confirmed?: boolean
}

export function distanceKm(lat: number, lon: number, fromLat: number = GIMPO.lat, fromLon: number = GIMPO.lon): number {
  const radians = Math.PI / 180
  const a = Math.sin((lat - fromLat) * radians / 2) ** 2 +
    Math.cos(fromLat * radians) * Math.cos(lat * radians) * Math.sin((lon - fromLon) * radians / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))))
}

export function strikeKey(strike: NearbyStrike): string {
  const location = strike.lat !== undefined && strike.lon !== undefined
    ? `${strike.lat}:${strike.lon}` : `distance:${strike.distanceKm}`
  return `${Math.floor(strike.detectedAt / 1000)}:${location}`
}

export function sameStrike(a: NearbyStrike, b: NearbyStrike): boolean {
  if (Math.floor(a.detectedAt / 1000) !== Math.floor(b.detectedAt / 1000)) return false
  if (a.lat !== undefined && a.lon !== undefined && b.lat !== undefined && b.lon !== undefined) {
    return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lon - b.lon) < 0.00001
  }
  // Legacy WING rows contain distance rounded to one decimal, without coordinates.
  return Math.abs(a.distanceKm - b.distanceKm) <= 0.051
}

export function isStrikeConfirmed(strike: NearbyStrike, confirmedAt: number | null): boolean {
  return strike.confirmed ?? (confirmedAt !== null && strike.detectedAt <= confirmedAt)
}
