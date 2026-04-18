"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

interface SystemPortConfigProps {
  port: string
  protocol: "udp" | "tcp"
  onPortChange: (port: string) => void
  onProtocolChange: (protocol: "udp" | "tcp") => void
}

export function SystemPortConfig({
  port,
  protocol,
  onPortChange,
  onProtocolChange,
}: SystemPortConfigProps) {
  return (
    <div className="space-y-4">
      <div className="font-medium text-sm">포트 설정</div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="port" className="text-sm text-muted-foreground">
            포트 번호
          </Label>
          <Input
            id="port"
            type="number"
            value={port}
            onChange={(e) => onPortChange(e.target.value)}
            placeholder="예: 1892"
            min={1}
            max={65535}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">프로토콜</Label>
          <RadioGroup
            value={protocol}
            onValueChange={(value) => onProtocolChange(value as "udp" | "tcp")}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="udp" id="udp" />
              <Label htmlFor="udp" className="font-normal cursor-pointer">
                UDP
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="tcp" id="tcp" />
              <Label htmlFor="tcp" className="font-normal cursor-pointer">
                TCP
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </div>
  )
}
