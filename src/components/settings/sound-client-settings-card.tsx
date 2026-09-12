'use client'

import { useState } from 'react'
import { Loader2, MonitorSpeaker } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SoundClientSettingsCardProps {
  initialToken?: string
}

/** Shared token used to sign PC 확인 / 설정 전송 commands to SoundSense clients. */
export function SoundClientSettingsCard({ initialToken = '' }: SoundClientSettingsCardProps) {
  const [token, setToken] = useState(initialToken)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientToken: token.trim() }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('PC 클라이언트 설정이 저장되었습니다')
    } catch {
      toast.error('설정 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSpeaker className="h-4 w-4" />
          PC 클라이언트 (SoundSense)
        </CardTitle>
        <CardDescription>
          시설 추가/수정의 자동 탐지는 UDP 7790 포트로 같은 네트워크의 PC를 찾습니다.
          토큰을 설정하면 PC 확인·설정 전송 명령에 서명이 붙고, 같은 토큰을 가진 클라이언트만 응답합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="client-token">인증 토큰 (비워두면 서명 없이 전송)</Label>
          <Input
            id="client-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="예: tms-2026"
            autoComplete="off"
          />
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          저장
        </Button>
      </CardContent>
    </Card>
  )
}
