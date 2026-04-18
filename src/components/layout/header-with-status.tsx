'use client'

import { Settings, Volume2, VolumeX, DoorClosed, DoorOpen, Loader2, Maximize2, Minimize2 } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWebSocket } from '@/hooks/useWebSocket'
import { toast } from 'sonner'
import { useRealtime } from '@/components/realtime/realtime-provider'

const MUTE_DURATIONS = [
  { label: '1분', minutes: 1 },
  { label: '10분', minutes: 10 },
  { label: '30분', minutes: 30 },
  { label: '1시간', minutes: 60 },
  { label: '2시간', minutes: 120 },
  { label: '5시간', minutes: 300 },
]

export function HeaderWithStatus() {
  const { systems, audioMuted, muteEndTime, setAudioMute, featureFlags } = useRealtime()
  const [remainingTime, setRemainingTime] = useState<string>('')
  const [gateLoading, setGateLoading] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const { connected } = useWebSocket()

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const unmute = useCallback(async () => {
    setAudioMute(false)
    setRemainingTime('')
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioEnabled: 'true', muteEndTime: '' }),
      })
    } catch {
      // ignore
    }
  }, [setAudioMute])

  // Countdown timer derived from context muteEndTime
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (!audioMuted || !muteEndTime) {
      setRemainingTime('')
      return
    }

    const updateRemaining = () => {
      const diff = muteEndTime - Date.now()
      if (diff <= 0) {
        unmute()
      } else {
        const mins = Math.floor(diff / 60000)
        const secs = Math.floor((diff % 60000) / 1000)
        if (mins >= 60) {
          const hrs = Math.floor(mins / 60)
          const remainMins = mins % 60
          setRemainingTime(`${hrs}시간 ${remainMins}분`)
        } else if (mins > 0) {
          setRemainingTime(`${mins}분 ${secs}초`)
        } else {
          setRemainingTime(`${secs}초`)
        }
      }
    }
    updateRemaining()
    timerRef.current = setInterval(updateRemaining, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [audioMuted, muteEndTime, unmute])

  const handleMuteDuration = async (minutes: number) => {
    const endTime = Date.now() + minutes * 60 * 1000
    setAudioMute(true, endTime)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioEnabled: 'false',
          muteEndTime: String(endTime),
        }),
      })
    } catch {
      // ignore
    }
  }

  const handleGateOpen = async () => {
    setGateLoading(true)
    try {
      const res = await fetch('/api/gate', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error('게이트 제어에 실패했습니다')
    } finally {
      setGateLoading(false)
    }
  }

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  }

  const allSystems = systems ?? []
  const enabledSystems = allSystems.filter(s => s.isEnabled !== false)
  const disabledSystems = allSystems.filter(s => s.isEnabled === false)

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-foreground">통합알람감시체계</h1>
          {allSystems.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#4ade80]" />
                <span className="tabular-nums font-medium text-[#4ade80]">
                  {enabledSystems.filter((s) => s.status === 'normal').length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#facc15]" />
                <span className="tabular-nums font-medium text-[#facc15]">
                  {enabledSystems.filter((s) => s.status === 'warning' || s.status === 'offline').length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#f87171]" />
                <span className="tabular-nums font-medium text-[#f87171]">
                  {enabledSystems.filter((s) => s.status === 'critical').length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#a1a1aa]" />
                <span className="tabular-nums font-medium text-[#a1a1aa]">
                  {disabledSystems.length}
                </span>
              </div>
            </div>
          )}
          {!connected && (
            <span className="text-sm font-medium text-[#f87171]">WebSocket 연결끊김</span>
          )}
        </div>

      <div className="flex items-center gap-4">
        {!audioMuted ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Volume2 className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {MUTE_DURATIONS.map((duration) => (
                <DropdownMenuItem
                  key={duration.minutes}
                  onClick={() => handleMuteDuration(duration.minutes)}
                >
                  {duration.label} 음소거
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={unmute}
            className="relative"
            title={remainingTime ? `${remainingTime} 남음` : '음소거 해제'}
          >
            <VolumeX className="h-5 w-5 text-muted-foreground" />
            {remainingTime && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap">
                {remainingTime}
              </span>
            )}
          </Button>
        )}

        {featureFlags.gateEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className="group"
            onClick={handleGateOpen}
            disabled={gateLoading}
            title="게이트 열기"
          >
            {gateLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <DoorClosed className="h-5 w-5 group-hover:hidden" />
                <DoorOpen className="h-5 w-5 hidden group-hover:block" />
              </>
            )}
          </Button>
        )}

        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <Settings className="h-5 w-5" />
          </Button>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          title={isFullscreen ? '전체화면 종료' : '전체화면'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-5 w-5" />
          ) : (
            <Maximize2 className="h-5 w-5" />
          )}
        </Button>
      </div>
    </header>
  )
}
