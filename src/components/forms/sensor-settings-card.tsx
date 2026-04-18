import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SystemMetricsConfig } from "@/components/forms/system-metrics-config"
import type { MetricsConfig, SystemType } from "@/types"

interface SensorSettingsCardProps {
  config: MetricsConfig
  onChange: (config: MetricsConfig) => void
  systemType: SystemType
  disabled: boolean
}

export function SensorSettingsCard({
  config,
  onChange,
  systemType,
  disabled,
}: SensorSettingsCardProps) {
  return (
    <Card className="flex-1 flex flex-col overflow-hidden p-0">
      <CardHeader className="shrink-0 py-2">
        <CardTitle className="text-sm">온습도 설정</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-2 overflow-y-auto px-3 pb-3">
        {/* 온도 설정 (상단 50%) */}
        <div className="flex-1 min-h-0 border rounded-lg p-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">온도</div>
          <SystemMetricsConfig
            config={config}
            onChange={onChange}
            typeLabel="온도"
            systemType={systemType}
            fixedSensorMode={true}
            disabled={disabled}
            sensorItemName="온도"
          />
        </div>

        {/* 습도 설정 (하단 50%) */}
        <div className="flex-1 min-h-0 border rounded-lg p-2">
          <div className="text-xs font-medium text-muted-foreground mb-1">습도</div>
          <SystemMetricsConfig
            config={config}
            onChange={onChange}
            typeLabel="습도"
            systemType={systemType}
            fixedSensorMode={true}
            disabled={disabled}
            sensorItemName="습도"
          />
        </div>
      </CardContent>
    </Card>
  )
}
