'use client'

import {
  LayoutDashboard,
  AlertTriangle,
  Thermometer,
  ChevronLeft,
  ChevronRight,
  BatteryCharging,
  Info
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRealtime } from '@/components/realtime/realtime-provider'

const navItems = [
  { href: '/', label: '대시보드', icon: LayoutDashboard },
  { href: '/temperature', label: '온습도', icon: Thermometer },
  { href: '/ups', label: 'UPS', icon: BatteryCharging },
  { href: '/alarms', label: '알람 로그', icon: AlertTriangle },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const { alarms, featureFlags } = useRealtime()
  const alarmCount = alarms.filter(a => !a.acknowledged && !a.resolvedAt).length

  const filteredNavItems = navItems.filter((item) => {
    if (item.href === '/temperature' && !featureFlags.temperatureEnabled) return false
    if (item.href === '/ups' && !featureFlags.upsEnabled) return false
    return true
  })

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-sidebar transition-all duration-300 overflow-visible',
        collapsed ? 'w-16' : 'w-48'
      )}
    >
      <nav className="flex-1 flex flex-col p-2 overflow-visible">
        <div className="space-y-1">
          {filteredNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href))

            const showBadge = item.href === '/alarms' && alarmCount > 0

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors relative',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <div className="relative shrink-0">
                  <Icon className="h-5 w-5" />
                  {showBadge && collapsed && (
                    <Badge
                      variant="destructive"
                      className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full p-0 text-[10px]"
                    >
                      {alarmCount > 9 ? '9+' : alarmCount}
                    </Badge>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span>{item.label}</span>
                    {showBadge && (
                      <Badge variant="destructive" className="ml-auto text-xs">
                        {alarmCount > 99 ? '99+' : alarmCount}
                      </Badge>
                    )}
                  </>
                )}
              </Link>
            )
          })}
        </div>
        <div className="mt-auto relative h-6 mb-1">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="absolute top-0 left-1/2 flex items-center rounded-full bg-muted/80 hover:bg-muted text-muted-foreground/60 hover:text-muted-foreground z-50 whitespace-nowrap transition-all duration-300 ease-in-out"
            style={{
              width: showInfo ? '190px' : '22px',
              height: '22px',
              marginLeft: '-11px',
              paddingRight: showInfo ? '10px' : '0px',
            }}
          >
            <div className="w-[22px] h-[22px] flex items-center justify-center shrink-0">
              <Info className="h-3 w-3 shrink-0" />
            </div>
            <span
              className="text-[10px] overflow-hidden transition-all duration-300 ease-in-out flex-1 text-center"
              style={{
                maxWidth: showInfo ? '160px' : '0px',
                opacity: showInfo ? 1 : 0,
              }}
            >
              Developed by 13615 &amp; Claude
            </span>
          </button>
        </div>
      </nav>

      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  )
}
