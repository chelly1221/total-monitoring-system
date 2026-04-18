'use client'

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, Upload, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export function DataManagementCard() {
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    setIsExporting(true)
    try {
      const res = await fetch('/api/backup')
      if (!res.ok) throw new Error('Export failed')
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `alarm-backup-${date}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('백업 파일을 다운로드했습니다')
    } catch {
      toast.error('내보내기에 실패했습니다')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleImport(file: File) {
    setIsImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.version || !data.systems) {
        toast.error('올바른 백업 파일이 아닙니다')
        return
      }
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      if (!res.ok) throw new Error('Import failed')
      toast.success('데이터를 복원했습니다. 페이지를 새로고침합니다...')
      setTimeout(() => window.location.reload(), 1000)
    } catch {
      toast.error('가져오기에 실패했습니다')
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true)
      setTimeout(() => setConfirmReset(false), 3000)
      return
    }
    setIsResetting(true)
    try {
      const res = await fetch('/api/backup', { method: 'DELETE' })
      if (!res.ok) throw new Error('Reset failed')
      toast.success('데이터를 초기화했습니다. 페이지를 새로고침합니다...')
      setTimeout(() => window.location.reload(), 1000)
    } catch {
      toast.error('초기화에 실패했습니다')
    } finally {
      setIsResetting(false)
      setConfirmReset(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>DB 관리</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? '내보내는 중...' : '내보내기'}
          </Button>
          <div className="flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImport(file)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              <Upload className="h-4 w-4 mr-1" />
              {isImporting ? '복원 중...' : '가져오기'}
            </Button>
          </div>
          <Button
            variant={confirmReset ? 'destructive' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={handleReset}
            disabled={isResetting}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {isResetting
              ? '초기화 중...'
              : confirmReset
                ? '정말 삭제?'
                : '초기화'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
