"use client"

import * as React from "react"
import { useRouter, useParams } from "next/navigation"

import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function SirenEditPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [location, setLocation] = React.useState("")
  const [ip, setIp] = React.useState("")
  const [port, setPort] = React.useState("")
  const [protocol, setProtocol] = React.useState("tcp")
  const [messageOn, setMessageOn] = React.useState("")
  const [messageOff, setMessageOff] = React.useState("")

  React.useEffect(() => {
    async function fetchSiren() {
      try {
        const res = await fetch(`/api/sirens/${id}`)
        if (!res.ok) throw new Error("사이렌 장비를 찾을 수 없습니다")
        const data = await res.json()
        setLocation(data.location)
        setIp(data.ip)
        setPort(String(data.port))
        setProtocol(data.protocol)
        setMessageOn(data.messageOn)
        setMessageOff(data.messageOff)
      } catch (err) {
        setError(err instanceof Error ? err.message : "데이터 로드 실패")
      } finally {
        setLoading(false)
      }
    }
    fetchSiren()
  }, [id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      if (!location.trim() || !ip.trim() || !port.trim() || !messageOn.trim()) {
        throw new Error("모든 항목을 입력해주세요")
      }

      const portNum = parseInt(port, 10)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error("포트 번호는 1-65535 범위여야 합니다")
      }

      const res = await fetch(`/api/sirens/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: ip.trim(),
          port: portNum,
          protocol,
          messageOn: messageOn.trim(),
          messageOff: messageOff.trim(),
          location: location.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "수정에 실패했습니다")
      }

      router.push("/settings")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 pb-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          뒤로
        </Button>
        <h1 className="text-xl font-bold">사이렌 장비 수정</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <div className="space-y-4 rounded-lg border bg-card p-6 max-w-xl">
          <div className="space-y-2">
            <Label htmlFor="location">설치장소</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="예: 관제탑 1층"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ip">IP 주소</Label>
            <Input
              id="ip"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="예: 192.168.1.100"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="port">포트</Label>
              <Input
                id="port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="예: 5000"
                className=""
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="protocol">프로토콜</Label>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger id="protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="udp">UDP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="messageOn">작동 메시지</Label>
            <Input
              id="messageOn"
              value={messageOn}
              onChange={(e) => setMessageOn(e.target.value)}
              placeholder="예: ALARM_ON"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="messageOff">중지 메시지</Label>
            <Input
              id="messageOff"
              value={messageOff}
              onChange={(e) => setMessageOff(e.target.value)}
              placeholder="예: ALARM_OFF"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive max-w-xl">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-4 mt-4 max-w-xl">
          <Button type="button" variant="outline" disabled={saving} onClick={() => router.back()}>
            취소
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            수정
          </Button>
        </div>
      </form>
    </div>
  )
}
