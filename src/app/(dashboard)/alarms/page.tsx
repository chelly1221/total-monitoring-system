import { prisma } from '@/lib/db'
import { AlarmsClient } from '@/components/alarms/alarms-client'

export const dynamic = 'force-dynamic'

async function getAlarms() {
  // NOTE: alarm creation for offline systems is owned entirely by the worker
  // (syncOfflineAlarms, run on the offline-detection interval). A GET/render must not
  // mutate the DB — doing so here previously duplicated alarms across concurrent tabs and
  // raced the worker.
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
