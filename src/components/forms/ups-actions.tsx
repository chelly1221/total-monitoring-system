'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useWindowHref } from '@/hooks/use-window-href'
import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PrismaSystem } from '@/types'

interface UpsActionsProps {
  system: PrismaSystem
  onEnabledChange?: (enabled: boolean) => void
  onEditClick?: () => void
}

export function UpsActions({
  system,
  onEnabledChange,
  onEditClick,
}: UpsActionsProps) {
  const router = useRouter()
  const windowHref = useWindowHref()
  const [isEnabled, setIsEnabled] = React.useState(system.isEnabled !== false)
  const [toggling, setToggling] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const handleToggleEnabled = async (checked: boolean) => {
    setToggling(true)
    try {
      const response = await fetch(`/api/systems/${system.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: checked }),
      })
      if (response.ok) {
        setIsEnabled(checked)
        onEnabledChange?.(checked)
        router.refresh()
      }
    } catch {
      setIsEnabled(!checked)
    } finally {
      setToggling(false)
    }
  }

  const handleDelete = async () => {
    if (
      !confirm(
        `${system.name}을(를) 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`
      )
    ) {
      return
    }

    setDeleting(true)
    try {
      const response = await fetch(`/api/systems/${system.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        router.push(windowHref('/ups'))
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Switch
        id="enabled-toggle"
        aria-label="장비 감시 사용"
        checked={isEnabled}
        onCheckedChange={handleToggleEnabled}
        disabled={toggling}
      />
      {onEditClick ? (
        <Button
          variant="outline"
          size="sm"

          onClick={onEditClick}
        >
          <Pencil className="h-4 w-4" />
          수정
        </Button>
      ) : (
        <Link href={windowHref(`/ups/${system.id}`)}>
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4" />
            수정
          </Button>
        </Link>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleDelete}
        disabled={deleting}
        className="text-red-500 hover:bg-red-500/10 hover:text-red-500"
      >
        <Trash2 className="h-4 w-4" />
        삭제
      </Button>
    </div>
  )
}
