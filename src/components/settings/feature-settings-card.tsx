'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface FeatureSettingsCardProps {
  initialTemperatureEnabled?: boolean
  initialUpsEnabled?: boolean
  initialGateEnabled?: boolean
  initialWing15Enabled?: boolean
}

export function FeatureSettingsCard({
  initialTemperatureEnabled = true,
  initialUpsEnabled = true,
  initialGateEnabled = true,
  initialWing15Enabled = true,
}: FeatureSettingsCardProps) {
  const [temperatureEnabled, setTemperatureEnabled] = useState(initialTemperatureEnabled)
  const [upsEnabled, setUpsEnabled] = useState(initialUpsEnabled)
  const [gateEnabled, setGateEnabled] = useState(initialGateEnabled)
  const [wing15Enabled, setWing15Enabled] = useState(initialWing15Enabled)

  const handleToggle = async (key: string, value: boolean, setter: (v: boolean) => void) => {
    setter(value)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: String(value) }),
      })
      if (!res.ok) throw new Error()
      toast.success('설정이 저장되었습니다')
    } catch {
      setter(!value)
      toast.error('설정 저장에 실패했습니다')
    }
  }

  return (
    <section className="settings-panel">
      <header className="settings-panel-header flex items-start justify-between gap-4">
        <div><h2>기능 표시</h2><p>사용할 감시 화면과 제어 버튼을 선택합니다.</p></div>
        <span className="whitespace-nowrap text-[18px] text-muted-foreground">변경 즉시 저장</span>
      </header>
      <div className="settings-feature-rows">
        <div className="flex items-center justify-between">
          <Label htmlFor="temperature-toggle" className="cursor-pointer">온습도 탭</Label>
          <div className="flex items-center gap-3"><span className="settings-toggle-state" data-enabled={temperatureEnabled}>{temperatureEnabled ? '켜짐' : '꺼짐'}</span><Switch
            id="temperature-toggle"
            checked={temperatureEnabled}
            onCheckedChange={(v) => handleToggle('temperatureEnabled', v, setTemperatureEnabled)}
          /></div>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="ups-toggle" className="cursor-pointer">UPS 탭</Label>
          <div className="flex items-center gap-3"><span className="settings-toggle-state" data-enabled={upsEnabled}>{upsEnabled ? '켜짐' : '꺼짐'}</span><Switch
            id="ups-toggle"
            checked={upsEnabled}
            onCheckedChange={(v) => handleToggle('upsEnabled', v, setUpsEnabled)}
          /></div>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="gate-toggle" className="cursor-pointer">게이트 열기 버튼</Label>
          <div className="flex items-center gap-3"><span className="settings-toggle-state" data-enabled={gateEnabled}>{gateEnabled ? '켜짐' : '꺼짐'}</span><Switch
            id="gate-toggle"
            checked={gateEnabled}
            onCheckedChange={(v) => handleToggle('gateEnabled', v, setGateEnabled)}
          /></div>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="wing15-toggle" className="cursor-pointer">
            뇌전감시 <small>김포공항 5km</small>
          </Label>
          <div className="flex items-center gap-3"><span className="settings-toggle-state" data-enabled={wing15Enabled}>{wing15Enabled ? '켜짐' : '꺼짐'}</span><Switch
            id="wing15-toggle"
            checked={wing15Enabled}
            onCheckedChange={(v) => handleToggle('wing15Enabled', v, setWing15Enabled)}
          /></div>
        </div>
      </div>
    </section>
  )
}
