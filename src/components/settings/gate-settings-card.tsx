'use client'

import { useState } from 'react'
import { DoorClosed, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface GateSettingsCardProps {
  initialIp?: string
  initialPort?: string
  initialProtocol?: string
}

export function GateSettingsCard({
  initialIp = '192.168.1.150',
  initialPort = '6722',
  initialProtocol = 'tcp',
}: GateSettingsCardProps) {
  const [ip, setIp] = useState(initialIp)
  const [port, setPort] = useState(initialPort)
  const [protocol, setProtocol] = useState(initialProtocol)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const handleSave = async () => {
    const portNum = parseInt(port)
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast.error('포트 번호는 1-65535 범위여야 합니다')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateIp: ip,
          gatePort: port,
          gateProtocol: protocol,
        }),
      })

      if (!res.ok) throw new Error('저장 실패')
      toast.success('게이트 설정이 저장되었습니다')
    } catch {
      toast.error('설정 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/gate', { method: 'POST' })
      const data = await res.json()

      if (data.success) {
        toast.success(data.message)
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error('게이트 테스트에 실패했습니다')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="py-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <DoorClosed className="h-5 w-5" />
          <CardTitle>게이트 제어 설정</CardTitle>
        </div>
        <CardDescription>게이트 열림 명령 전송 설정</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="gate-ip">IP 주소</Label>
            <Input
              id="gate-ip"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.150"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gate-port">포트</Label>
            <Input
              id="gate-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="6722"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gate-protocol">프로토콜</Label>
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger id="gate-protocol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            저장
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            테스트
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
