import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SystemDataPreview } from "@/components/forms/system-data-preview"
import type { DataMatchCondition } from "@/types"

interface SensorDataPreviewCardProps {
  port: string
  connected: boolean
  messages: string[]
  getConditionsForItem: (name: string) => DataMatchCondition[] | undefined
}

export function SensorDataPreviewCard({
  port,
  connected,
  messages,
  getConditionsForItem,
}: SensorDataPreviewCardProps) {
  return (
    <Card className="flex-1 flex flex-col overflow-hidden p-0">
      <CardHeader className="shrink-0 py-2">
        <CardTitle className="text-sm">데이터 미리보기</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden px-3 pb-3">
        {/* 온도 미리보기 (상단 50%) */}
        <div className="flex-1 min-h-0 border rounded-lg p-3">
          <SystemDataPreview
            port={port}
            connected={connected}
            messages={messages}
            className="h-[calc(100%-1.5rem)]"
            label="온도"
            dataMatchConditions={getConditionsForItem("온도")}
          />
        </div>

        {/* 습도 미리보기 (하단 50%) */}
        <div className="flex-1 min-h-0 border rounded-lg p-3">
          <SystemDataPreview
            port={port}
            connected={connected}
            messages={messages}
            className="h-[calc(100%-1.5rem)]"
            label="습도"
            dataMatchConditions={getConditionsForItem("습도")}
          />
        </div>
      </CardContent>
    </Card>
  )
}
