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
}

export function FeatureSettingsCard({
  initialTemperatureEnabled = true,
  initialUpsEnabled = true,
  initialGateEnabled = true,
}: FeatureSettingsCardProps) {
  const [temperatureEnabled, setTemperatureEnabled] = useState(initialTemperatureEnabled)
  const [upsEnabled, setUpsEnabled] = useState(initialUpsEnabled)
  const [gateEnabled, setGateEnabled] = useState(initialGateEnabled)

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
    <Card className="py-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ToggleLeft className="h-5 w-5" />
          <CardTitle>기능 표시 설정</CardTitle>
        </div>
        <CardDescription>탭 및 버튼의 표시 여부를 설정합니다</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  )
}
