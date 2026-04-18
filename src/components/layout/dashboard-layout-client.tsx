'use client'

import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { RealtimeProvider } from '@/components/realtime/realtime-provider'
import { AudioAlertManager } from '@/components/realtime/audio-alert-manager'
import { HeaderWithStatus } from './header-with-status'
import { Sidebar } from './sidebar'
import type { PrismaSystem, PrismaAlarm } from '@/types'

interface DashboardLayoutClientProps {
  children: React.ReactNode
  initialSystems: PrismaSystem[]
  initialAlarms: PrismaAlarm[]
}

function DashboardShell({
  children,
  initialSystems,
  initialAlarms,
}: DashboardLayoutClientProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isStandalone = searchParams.get('standalone') === 'true'

  return (
    <RealtimeProvider initialSystems={initialSystems} initialAlarms={initialAlarms}>
      {pathname === '/' && <AudioAlertManager />}
      <div className="flex h-screen flex-col">
        <HeaderWithStatus />
        <div className="flex flex-1 overflow-hidden">
          {!isStandalone && <Sidebar />}
          <main className="relative flex-1 overflow-y-auto p-4">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  )
}

export function DashboardLayoutClient(props: DashboardLayoutClientProps) {
  return (
    <Suspense>
      <DashboardShell {...props} />
    </Suspense>
  )
}
