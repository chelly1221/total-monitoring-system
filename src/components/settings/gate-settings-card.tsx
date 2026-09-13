'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSettingsAutosave } from '@/hooks/use-settings-autosave'
import { gateSettingsError } from '@/lib/gate-settings'
import { AutosaveStatus } from './autosave-status'

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
  const autosave = useSettingsAutosave()
  const [testing, setTesting] = useState(false)

  const draft = { gateIp: ip.trim(), gatePort: port, gateProtocol: protocol }
  const error = gateSettingsError(draft)
  const canTest = !error && (autosave.status === 'idle' || autosave.status === 'saved')

  const update = (next: typeof draft, immediate = false) => {
    setIp(next.gateIp)
    setPort(next.gatePort)
    setProtocol(next.gateProtocol)
    const value = { ...next, gateIp: next.gateIp.trim() }
    autosave.schedule(gateSettingsError(value) ? undefined : value, immediate ? 0 : 500)
  }

  const handleTest = async () => {
    if (!canTest) return
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
    <section className="settings-panel">
      <header className="settings-panel-header">
        <div><h2>게이트 연결</h2>
          <p>게이트 열림 명령을 보낼 장비 주소입니다.</p></div>
      </header>
      <div className="settings-gate-content space-y-6">
        <div className="settings-gate-fields grid gap-4 sm:grid-cols-3" onBlur={() => { void autosave.flush() }}>
          <div className="space-y-2">
            <Label htmlFor="gate-ip">IP 주소</Label>
            <Input
              id="gate-ip"
              value={ip}
              onChange={(e) => update({ ...draft, gateIp: e.target.value })}
              aria-describedby="gate-save-status"
              aria-invalid={autosave.status === 'invalid' && !!gateSettingsError({ gateIp: ip.trim() })}
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
              onChange={(e) => update({ ...draft, gatePort: e.target.value })}
              aria-describedby="gate-save-status"
              aria-invalid={autosave.status === 'invalid' && !!gateSettingsError({ gatePort: port })}
              placeholder="6722"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gate-protocol">프로토콜</Label>
            <select id="gate-protocol" value={protocol} onChange={(event) => update({ ...draft, gateProtocol: event.target.value }, true)}>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
        </div>

        <div className="settings-gate-actions">
          <AutosaveStatus id="gate-save-status" status={autosave.status} error={error} />
          <Button variant="outline" onClick={handleTest} disabled={testing || !canTest}>
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            게이트 열림 테스트
          </Button>
        </div>
      </div>
    </section>
  )
}
