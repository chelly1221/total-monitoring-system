// Which text to show under a facility card on the main dashboard.
// A ping client (네트워크 ping 감시) reports the targets that stopped answering; the worker
// stores that summary in the open alarm's `value`. Other equipment alarms carry the raw
// pattern ("SOUND"), which says nothing to the operator, so only ping facilities get a line.
// No Node imports: shared by the dashboard and the tests.

interface SystemLike {
  id: string
  config?: string | null
}

interface AlarmLike {
  systemId: string
  severity?: string | null
  value?: string | null
  acknowledged?: boolean
  resolvedAt?: Date | string | null
}

/** True when the facility's config binds a ping client. */
export function isPingClientSystem(config: string | null | undefined): boolean {
  if (!config) return false
  try {
    const parsed = JSON.parse(config) as { client?: { kind?: unknown } }
    return parsed?.client?.kind === 'ping'
  } catch {
    return false
  }
}

/** Detail text per system id for open (unresolved) alarms of ping-client facilities. */
export function alarmDetailsBySystem(systems: SystemLike[], alarms: AlarmLike[]): Map<string, string> {
  const details = new Map<string, string>()
  const pingSystems = new Set(systems.filter(s => isPingClientSystem(s.config)).map(s => s.id))
  if (pingSystems.size === 0) return details
  for (const alarm of alarms) {
    if (alarm.resolvedAt || !pingSystems.has(alarm.systemId)) continue
    const value = alarm.value?.trim()
    if (!value) continue
    // Prefer a critical alarm's text when several alarms are open for the same facility.
    if (!details.has(alarm.systemId) || alarm.severity === 'critical') details.set(alarm.systemId, value)
  }
  return details
}
