import { prisma } from '@/lib/db'
import { AlarmsClient } from '@/components/alarms/alarms-client'

export const dynamic = 'force-dynamic'

async function getAlarms() {
  // Create alarm records for offline systems that have no active alarm
  const offlineSystemsWithoutAlarm = await prisma.system.findMany({
    where: {
      isEnabled: true,
      isActive: true,
      status: 'offline',
      alarms: { none: { resolvedAt: null } },
    },
  })

  for (const sys of offlineSystemsWithoutAlarm) {
    // UPS type: always use 'critical' severity
    const severity = sys.type === 'ups' ? 'critical' : 'warning'
    await prisma.alarm.create({
      data: {
        systemId: sys.id,
        severity,
        message: `${sys.name} 오프라인`,
      },
    })
  }

  const [activeAlarms, acknowledgedAlarms, systems] = await Promise.all([
    prisma.alarm.findMany({
      where: { acknowledged: false, resolvedAt: null },
      include: { system: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.alarm.findMany({
      where: { OR: [{ acknowledged: true }, { resolvedAt: { not: null } }] },
      include: { system: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.system.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
  ])
  return { activeAlarms, acknowledgedAlarms, systems }
}

export default async function AlarmsPage() {
  const { activeAlarms, acknowledgedAlarms, systems } = await getAlarms()

  return (
    <AlarmsClient
      initialActiveAlarms={activeAlarms}
      initialAcknowledgedAlarms={acknowledgedAlarms}
      systems={systems}
    />
  )
}
