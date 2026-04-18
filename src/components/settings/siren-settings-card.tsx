'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, Pencil, Plus, Trash2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

interface Siren {
  id: string
  ip: string
  port: number
  protocol: string
  messageOn: string
  messageOff: string
  location: string
  isEnabled: boolean
}

interface SirenSettingsCardProps {
  initialSirens: Siren[]
}

export function SirenSettingsCard({ initialSirens }: SirenSettingsCardProps) {
  const [sirens, setSirens] = useState<Siren[]>(initialSirens)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sirens/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setSirens((prev) => prev.filter((s) => s.id !== id))
      toast.success('사이렌 장비가 삭제되었습니다')
    } catch {
      toast.error('삭제에 실패했습니다')
    } finally {
      setDeletingId(null)
    }
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      const res = await fetch(`/api/sirens/${id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error('사이렌 테스트에 실패했습니다')
    } finally {
      setTestingId(null)
    }
  }

  const handleToggle = async (id: string, isEnabled: boolean) => {
    try {
      const res = await fetch(`/api/sirens/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled }),
      })
      if (!res.ok) throw new Error()
      setSirens((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isEnabled } : s))
      )
    } catch {
      toast.error('상태 변경에 실패했습니다')
    }
  }

  return (
    <Card className="py-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <CardTitle>알람 사이렌 장비 관리</CardTitle>
          </div>
          <Link href="/settings/sirens/new">
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              장비 추가
            </Button>
          </Link>
        </div>
        <CardDescription>알람 발생 시 외부 사이렌 장비에 신호를 전송합니다</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Siren list */}
        {sirens.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            등록된 사이렌 장비가 없습니다
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
            {sirens.map((siren) => (
              <div
                key={siren.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-2"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <Switch
                    checked={siren.isEnabled}
                    onCheckedChange={(checked) => handleToggle(siren.id, checked)}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{siren.location}</span>
                      <span className="text-xs text-muted-foreground">
                        {siren.ip}:{siren.port} ({siren.protocol.toUpperCase()})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      작동: {siren.messageOn}{siren.messageOff ? ` / 중지: ${siren.messageOff}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(siren.id)}
                    disabled={testingId === siren.id}
                    title="테스트"
                  >
                    {testingId === siren.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </Button>
                  <Link href={`/settings/sirens/${siren.id}/edit`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="편집"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(siren.id)}
                    disabled={deletingId === siren.id}
                    title="삭제"
                  >
                    {deletingId === siren.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
