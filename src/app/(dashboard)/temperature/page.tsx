import { prisma } from '@/lib/db'
import { RealtimeTemperaturePanel } from '@/components/realtime/realtime-temperature'

export const dynamic = 'force-dynamic'

async function getSensorData() {
  const sensorSystems = await prisma.system.findMany({
    where: { type: 'sensor', isActive: true },
    include: { metrics: true },
    orderBy: { name: 'asc' },
  })

  return { sensorSystems }
}

export default async function TemperaturePage() {
  const { sensorSystems } = await getSensorData()

  const sensorSystemIds = sensorSystems.map((s) => s.id)

  return <RealtimeTemperaturePanel sensorSystemIds={sensorSystemIds} />
}
