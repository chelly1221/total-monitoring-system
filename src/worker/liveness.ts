// In-memory liveness registry for offline detection.
//
// Records the wall-clock time each ingest source last received ANY bytes,
// updated SYNCHRONOUSLY on the socket / MQTT receive path — BEFORE the packet
// enters the ingest queue. Offline detection consults this so a slow or stalled
// drainer (e.g. blocked on a siren network call) or a momentarily locked SQLite
// can NOT manufacture a false "offline": liveness reflects bytes arriving on the
// wire, independent of how fast they are persisted to the DB lastDataAt column.
//
// This is intentionally process-memory only. It resets on worker restart; the
// persisted lastDataAt survives a restart, so offline detection uses the MAX of
// the two and is correct in both cases.

const lastSeen = new Map<string, number>()

/**
 * Stable key for an ingest source. MQTT systems are addressed by topic (they have
 * no bound port); UDP/TCP systems are addressed by protocol+port.
 */
export function livenessKey(
  protocol: string | null | undefined,
  port: number | null | undefined,
  topic?: string | null,
): string {
  if (protocol === 'mqtt') return `mqtt:${topic ?? ''}`
  return `${protocol ?? '?'}:${port ?? -1}`
}

/** Record that bytes arrived for this source right now. */
export function markSeen(key: string): void {
  lastSeen.set(key, Date.now())
}

/** Epoch ms of the last received bytes for this source, or 0 if never seen. */
export function getLastSeen(key: string): number {
  return lastSeen.get(key) ?? 0
}

/** Forget a source (called when its socket/subscription is unbound). */
export function clearLiveness(key: string): void {
  lastSeen.delete(key)
}
