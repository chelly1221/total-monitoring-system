import { prisma } from '@/lib/db'
import { DashboardLayoutClient } from '@/components/layout/dashboard-layout-client'

async function getSystems() {
  return prisma.system.findMany({
    where: { isActive: true },
    include: { metrics: true },
    orderBy: { name: 'asc' },
  })
}

async function getActiveAlarms() {
  return prisma.alarm.findMany({
    where: { acknowledged: false, resolvedAt: null },
    include: { system: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [systems, activeAlarms] = await Promise.all([
    getSystems(),
    getActiveAlarms(),
  ])

  return (
    <DashboardLayoutClient
      initialSystems={systems}
      initialAlarms={activeAlarms}
    >
      {children}
    </DashboardLayoutClient>
  )
}
