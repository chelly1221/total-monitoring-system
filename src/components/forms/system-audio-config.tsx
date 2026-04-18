"use client"

import * as React from "react"
import { Volume2, Upload, Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { AudioConfig, AudioAlertType } from "@/types"

interface SystemAudioConfigProps {
  config: AudioConfig
  onChange: (config: AudioConfig) => void
  compact?: boolean
}

export function SystemAudioConfig({ config, onChange, compact = false }: SystemAudioConfigProps) {
  const [uploading, setUploading] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  const handleTypeChange = (type: AudioAlertType) => {
    onChange({ ...config, type })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/audio/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "업로드 실패")
      }

      const { fileName } = await response.json()
      onChange({ ...config, fileName })
    } catch (err) {
      alert(err instanceof Error ? err.message : "업로드 오류")
    } finally {
      setUploading(false)
    }
  }

  const handlePreviewFile = () => {
    if (playing) {
      audioRef.current?.pause()
      if (audioRef.current) audioRef.current.currentTime = 0
      setPlaying(false)
      return
    }

    if (!config.fileName) return

    const audio = new Audio(`/api/audio/${config.fileName}`)
    audio.onended = () => setPlaying(false)
    audio.onerror = () => {
      setPlaying(false)
      alert("파일 재생에 실패했습니다")
    }
    audioRef.current = audio
    setPlaying(true)
    audio.play()
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded border px-2 py-1">
        <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground shrink-0">경고 음성</span>
        <RadioGroup
          value={config.type}
          onValueChange={(v) => handleTypeChange(v as AudioAlertType)}
          className="flex gap-3"
        >
          <div className="flex items-center space-x-1">
            <RadioGroupItem value="none" id="audio-none-c" className="h-3.5 w-3.5" />
            <Label htmlFor="audio-none-c" className="cursor-pointer font-normal text-xs">없음</Label>
          </div>
          <div className="flex items-center space-x-1">
            <RadioGroupItem value="file" id="audio-file-c" className="h-3.5 w-3.5" />
            <Label htmlFor="audio-file-c" className="cursor-pointer font-normal text-xs">파일</Label>
          </div>
        </RadioGroup>
        {config.type === "file" && (
          <>
            <Label
              htmlFor="audio-upload-c"
              className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:bg-accent shrink-0"
            >
              <Upload className="h-3 w-3" />
              {uploading ? "..." : config.fileName || "파일 선택"}
            </Label>
            <input
              id="audio-upload-c"
              type="file"
              accept=".mp3,.wav"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
            {config.fileName && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-6 w-6"
                onClick={handlePreviewFile}
              >
                {playing ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </Button>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Volume2 className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">경고 음성 설정</Label>
      </div>

      <div className="flex items-center gap-6">
        <RadioGroup
          value={config.type}
          onValueChange={(v) => handleTypeChange(v as AudioAlertType)}
          className="flex gap-6"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="none" id="audio-none" />
            <Label htmlFor="audio-none" className="cursor-pointer font-normal">
              없음
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="file" id="audio-file" />
            <Label htmlFor="audio-file" className="cursor-pointer font-normal">
              파일
            </Label>
          </div>
        </RadioGroup>

        <div className="flex items-center gap-2">
          <Label
            htmlFor="audio-upload"
            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "업로드 중..." : config.fileName || "파일 선택"}
          </Label>
          <input
            id="audio-upload"
            type="file"
            accept=".mp3,.wav"
            onChange={handleFileUpload}
            className="hidden"
            disabled={uploading}
          />
          {config.fileName && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreviewFile}
            >
              {playing ? (
                <Square className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
