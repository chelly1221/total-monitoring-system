import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface SensorBasicInfoBarProps {
  name: string
  port: string
  protocol: "udp" | "tcp"
  isEditMode: boolean
  onNameChange: (value: string) => void
  onPortChange: (value: string) => void
  onProtocolChange: (value: "udp" | "tcp") => void
}

export function SensorBasicInfoBar({
  name,
  port,
  protocol,
  isEditMode,
  onNameChange,
  onPortChange,
  onProtocolChange,
}: SensorBasicInfoBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-card p-4 shrink-0">
      <div className="flex items-center gap-2">
        <Label htmlFor="name" className="whitespace-nowrap">시설명</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="예: 온습도 센서"
          className="w-64"
          disabled={!isEditMode}
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="port" className="whitespace-nowrap">포트</Label>
        <Input
          id="port"
          type="number"
          value={port}
          onChange={(e) => onPortChange(e.target.value)}
          placeholder="1892"
          className="w-24"
          disabled={!isEditMode}
          min={1}
          max={65535}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="whitespace-nowrap">프로토콜</Label>
        <Select
          value={protocol}
          onValueChange={(value) => onProtocolChange(value as "udp" | "tcp")}
          disabled={!isEditMode}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="udp">UDP</SelectItem>
            <SelectItem value="tcp">TCP</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
