import { prisma } from '@/lib/db'
import { RealtimeUpsPanel } from '@/components/realtime/realtime-ups'

export const dynamic = 'force-dynamic'

async function getUpsData() {
  const upsSystems = await prisma.system.findMany({
    where: { type: 'ups', isActive: true },
    include: { metrics: true },
    orderBy: { name: 'asc' },
  })

  return { upsSystems }
}

export default async function UpsPage() {
  const { upsSystems } = await getUpsData()

  const upsSystemIds = upsSystems.map((s) => s.id)

  return <RealtimeUpsPanel upsSystemIds={upsSystemIds} />
}
