'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Pencil, Plus, Trash2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
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
    <section className="settings-panel">
      <header className="settings-panel-header">
        <div className="flex items-center justify-between">
          <h2>알람 사이렌 <span className="text-[20px] font-normal text-muted-foreground">{sirens.length}대</span></h2>
            <Button size="sm" asChild><Link href="/settings/sirens/new">
              <Plus className="mr-1 h-4 w-4" />
              장비 추가
            </Link></Button>
        </div>
        <p>알람 발생 시 신호를 전송할 외부 장비입니다.</p>
      </header>
      <div>
        {sirens.length === 0 ? (
          <div className="border-y border-border py-10 text-center">
            <p className="text-[26px] font-semibold">등록된 사이렌이 없습니다</p>
            <p className="mt-3 text-[22px] text-muted-foreground">외부 사이렌을 사용하려면 장비를 추가하세요.</p>
          </div>
        ) : (
          <div>
            {sirens.map((siren) => (
              <div
                key={siren.id}
                className="settings-siren-row"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <Switch
                    aria-label={`${siren.location} 사용`}
                    checked={siren.isEnabled}
                    onCheckedChange={(checked) => handleToggle(siren.id, checked)}
                  />
                  <span className="settings-toggle-state" data-enabled={siren.isEnabled}>{siren.isEnabled ? '켜짐' : '꺼짐'}</span>
                  <div className="min-w-0">
                    <div className="flex flex-col gap-1">
                      <span className="break-words text-[26px] font-semibold">{siren.location}</span>
                      <span className="text-[20px] text-muted-foreground">
                        {siren.ip}:{siren.port} ({siren.protocol.toUpperCase()})
                      </span>
                    </div>
                    <p className="mt-2 break-all text-[18px] text-muted-foreground">
                      작동: {siren.messageOn}{siren.messageOff ? ` / 중지: ${siren.messageOff}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(siren.id)}
                    disabled={testingId === siren.id}
                    aria-label={`${siren.location} 테스트`}
                  >
                    {testingId === siren.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                    테스트
                  </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                    ><Link href={`/settings/sirens/${siren.id}/edit`} aria-label={`${siren.location} 편집`}>
                      <Pencil className="h-4 w-4" />
                      편집
                    </Link></Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(siren.id)}
                    disabled={deletingId === siren.id}
                    aria-label={`${siren.location} 삭제`}
                  >
                    {deletingId === siren.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                    삭제
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
