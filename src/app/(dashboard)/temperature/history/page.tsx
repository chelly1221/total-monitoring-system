import { Suspense } from 'react'
import { TemperatureHistory } from '@/components/realtime/temperature-history'

export const dynamic = 'force-dynamic'

export default function TemperatureHistoryPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">로딩 중...</div>}>
      <TemperatureHistory />
    </Suspense>
  )
}
