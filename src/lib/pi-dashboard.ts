import type { Alarm, System } from '@prisma/client'
import type { Wing15State } from '@/types'

export function piDashboard(systems: System[], alarms: (Alarm & { system: System })[], id: string, wing?: Wing15State) {
  const channels = systems.flatMap(system => {
    try {
      const config = JSON.parse(system.config || '{}')
      return config.client?.kind === 'pi' && config.client.id === id
        ? [{ id: config.client.channel, name: system.name, displayItems: config.displayItems || [] }] : []
    } catch { return [] }
  })
  if (!channels.length) return null
  const items = alarms.map(alarm => ({
    id: alarm.id, severity: alarm.severity, title: `${alarm.system.name} · ${alarm.message}`,
    detail: alarm.value || '', kind: alarm.system.type, source: 'server',
    occurredAt: alarm.lastSeenAt.toISOString(), occurrence: alarm.occurrenceCount,
  }))
  for (const item of wing?.items || []) {
    if (item.active) items.push({ id: `lightning:${item.key}`, severity: 'critical', title: item.title,
      detail: `${item.strikeCount || 0}회 · ${wing?.ok ? '뇌전 감시' : '자료 갱신 지연'}`,
      kind: 'lightning', source: 'server', occurredAt: item.startAt, occurrence: item.strikeCount || 1 })
  }
  return { v: 1, channels, alarms: items, serverTime: new Date().toISOString() }
}
