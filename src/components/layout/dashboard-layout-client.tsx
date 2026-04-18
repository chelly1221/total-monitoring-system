'use client'

import { usePathname } from 'next/navigation'
import { RealtimeProvider } from '@/components/realtime/realtime-provider'
import { AudioAlertManager } from '@/components/realtime/audio-alert-manager'
import { HeaderWithStatus } from './header-with-status'
import { Sidebar } from './sidebar'
import { FullscreenPrompt } from './fullscreen-prompt'
import type { PrismaSystem, PrismaAlarm } from '@/types'

interface DashboardLayoutClientProps {
  children: React.ReactNode
  initialSystems: PrismaSystem[]
  initialAlarms: PrismaAlarm[]
}

export function DashboardLayoutClient({
  children,
  initialSystems,
  initialAlarms,
}: DashboardLayoutClientProps) {
  const pathname = usePathname()

  return (
    <RealtimeProvider initialSystems={initialSystems} initialAlarms={initialAlarms}>
      {pathname === '/' && <AudioAlertManager />}
      <FullscreenPrompt />
      <div className="flex h-screen flex-col">
        <HeaderWithStatus />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="relative flex-1 overflow-y-auto p-4">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  )
}
