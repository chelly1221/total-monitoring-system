'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useRealtime } from '@/components/realtime/realtime-provider'

export function ServerAudioSettingsCard({ initialEnabled }: { initialEnabled: boolean }) {
  const { serverAudioEnabled, setServerAudioEnabled } = useRealtime()
  const [saving, setSaving] = useState(false)
  const enabled = serverAudioEnabled ?? initialEnabled

  const handleToggle = async (value: boolean) => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverAudioEnabled: String(value) }),
      })
      if (!response.ok) throw new Error('Failed to save server audio setting')
      setServerAudioEnabled(value)
      toast.success('설정이 저장되었습니다')
    } catch {
      toast.error('설정 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-panel">
      <header className="settings-panel-header">
        <div>
          <h2>서버 알람 소리</h2>
          <p id="server-audio-description">끄면 서버 PC에 설치된 앱에서 소리만 나지 않습니다. 알람 감지·표시·이력, 웹 접속 단말의 알람 소리와 기존 음소거 설정은 그대로 유지됩니다.</p>
        </div>
        <span>{saving ? '저장 중' : '변경 즉시 저장'}</span>
      </header>
      <div className="settings-feature-rows">
        <div className="flex items-center justify-between">
          <Label htmlFor="server-audio-toggle" className="cursor-pointer">서버 PC 알람 소리</Label>
          <div>
            <span className="settings-toggle-state" data-enabled={enabled}>{enabled ? '켜짐' : '꺼짐'}</span>
            <Switch id="server-audio-toggle" aria-describedby="server-audio-description" checked={enabled} disabled={saving} onCheckedChange={handleToggle} />
          </div>
        </div>
      </div>
    </section>
  )
}
