'use client'

import { useState } from 'react'
import { ToggleLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card className="flex flex-1 flex-col py-4">
      <CardHeader className="shrink-0">
        <div className="flex items-center gap-2">
          <ToggleLeft className="h-5 w-5" />
          <CardTitle>기능 표시 설정</CardTitle>
        </div>
        <CardDescription>탭·버튼 표시 여부와 뇌전감시 ON/OFF를 설정합니다</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="temperature-toggle" className="cursor-pointer">온습도 탭</Label>
          <Switch
            id="temperature-toggle"
            checked={temperatureEnabled}
            onCheckedChange={(v) => handleToggle('temperatureEnabled', v, setTemperatureEnabled)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="ups-toggle" className="cursor-pointer">UPS 탭</Label>
          <Switch
            id="ups-toggle"
            checked={upsEnabled}
            onCheckedChange={(v) => handleToggle('upsEnabled', v, setUpsEnabled)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="gate-toggle" className="cursor-pointer">게이트 열기 버튼</Label>
          <Switch
            id="gate-toggle"
            checked={gateEnabled}
            onCheckedChange={(v) => handleToggle('gateEnabled', v, setGateEnabled)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="wing15-toggle" className="cursor-pointer">
            뇌전감시 (김포공항 5km)
          </Label>
          <Switch
            id="wing15-toggle"
            checked={wing15Enabled}
            onCheckedChange={(v) => handleToggle('wing15Enabled', v, setWing15Enabled)}
          />
        </div>
      </CardContent>
    </Card>
  )
}
