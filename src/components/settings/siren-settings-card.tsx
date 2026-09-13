'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
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
        <div>
          <h2>알람 사이렌 <span className="settings-siren-count">{sirens.length}대</span></h2>
          <p>알람 발생 시 신호를 전송할 외부 장비입니다.</p>
        </div>
        <Button size="sm" asChild><Link href="/settings/sirens/new">장비 추가</Link></Button>
      </header>
      <div className="settings-siren-body">
        {sirens.length === 0 ? (
          <div className="settings-siren-empty">
            <strong>등록된 사이렌이 없습니다</strong>
            <p>외부 사이렌을 사용하려면 장비를 추가하세요.</p>
          </div>
        ) : (
          <table className="settings-siren-table" aria-label="알람 사이렌 목록">
            <colgroup><col className="settings-device-col" /><col className="settings-state-col" /><col className="settings-actions-col" /></colgroup>
            <thead><tr><th scope="col">장비 / 연결 주소</th><th scope="col">사용 여부</th><th scope="col">장비 관리</th></tr></thead>
            <tbody>
              {sirens.map((siren) => (
                <tr key={siren.id}>
                  <td>
                    <strong className="settings-siren-name">{siren.location}</strong>
                    <span className="settings-siren-address">{siren.ip}:{siren.port} · {siren.protocol.toUpperCase()}</span>
                  </td>
                  <td>
                    <div className="settings-siren-state">
                      <span className="settings-toggle-state" data-enabled={siren.isEnabled}>{siren.isEnabled ? '켜짐' : '꺼짐'}</span>
                      <Switch aria-label={siren.location + ' 사용'} checked={siren.isEnabled} onCheckedChange={(checked) => handleToggle(siren.id, checked)} />
                    </div>
                  </td>
                  <td>
                    <div className="settings-siren-actions">
                      <Button variant="outline" size="sm" onClick={() => handleTest(siren.id)} disabled={testingId === siren.id} aria-label={siren.location + ' 테스트'}>
                        {testingId === siren.id && <Loader2 className="animate-spin" />}테스트
                      </Button>
                      <Button variant="outline" size="sm" asChild><Link href={'/settings/sirens/' + siren.id + '/edit'} aria-label={siren.location + ' 편집'}>편집</Link></Button>
                      <Button variant="outline" size="sm" className="settings-danger" onClick={() => handleDelete(siren.id)} disabled={deletingId === siren.id} aria-label={siren.location + ' 삭제'}>
                        {deletingId === siren.id && <Loader2 className="animate-spin" />}삭제
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="settings-siren-foot">테스트 시 해당 장비에 신호를 전송합니다.</p>
    </section>
  )
}
