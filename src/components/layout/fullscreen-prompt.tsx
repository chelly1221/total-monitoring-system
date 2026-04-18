'use client'

import { useState, useEffect } from 'react'
import { Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

export function FullscreenPrompt() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Skip if already in fullscreen or already prompted this session
    if (document.fullscreenElement) return
    if (sessionStorage.getItem('fullscreen-prompted')) return

    // Small delay to let the page render first
    const timer = setTimeout(() => {
      if (!document.fullscreenElement) {
        setOpen(true)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [])

  const handleFullscreen = async () => {
    sessionStorage.setItem('fullscreen-prompted', '1')
    setOpen(false)
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      // ignore if fullscreen request fails
    }
  }

  const handleClose = () => {
    sessionStorage.setItem('fullscreen-prompted', '1')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Maximize2 className="h-5 w-5" />
            전체화면 모드
          </DialogTitle>
          <DialogDescription>
            최적의 모니터링 환경을 위해 전체화면 모드를 권장합니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>
            닫기
          </Button>
          <Button onClick={handleFullscreen}>
            전체화면으로 전환
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
