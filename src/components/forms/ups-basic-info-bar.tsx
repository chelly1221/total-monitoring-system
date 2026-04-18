import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface UpsBasicInfoBarProps {
  name: string
  port: string
  protocol: "udp" | "tcp"
  isEditMode: boolean
  onNameChange: (value: string) => void
  onPortChange: (value: string) => void
  onProtocolChange: (value: "udp" | "tcp") => void
}

export function UpsBasicInfoBar({
  name,
  port,
  protocol,
  isEditMode,
  onNameChange,
  onPortChange,
  onProtocolChange,
}: UpsBasicInfoBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border bg-card px-2 py-1.5 shrink-0">
      <div className="flex items-center gap-1.5">
        <Label htmlFor="name" className="whitespace-nowrap text-xs text-muted-foreground">시설명</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="예: 관제송신 UPS"
          className="w-48 h-7 text-xs"
          disabled={!isEditMode}
          required
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label htmlFor="port" className="whitespace-nowrap text-xs text-muted-foreground">포트</Label>
        <Input
          id="port"
          type="number"
          value={port}
          onChange={(e) => onPortChange(e.target.value)}
          placeholder="1892"
          className="w-20 h-7 text-xs"
          disabled={!isEditMode}
          min={1}
          max={65535}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label className="whitespace-nowrap text-xs text-muted-foreground">프로토콜</Label>
        <Select
          value={protocol}
          onValueChange={(value) => onProtocolChange(value as "udp" | "tcp")}
          disabled={!isEditMode}
        >
          <SelectTrigger className="w-20 h-7 text-xs">
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
