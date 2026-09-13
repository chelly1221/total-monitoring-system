'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Upload, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export function DataManagementCard({ initialHistoryMaxMb = '5120' }: { initialHistoryMaxMb?: string }) {
  const [historyLimit, setHistoryLimit] = useState(initialHistoryMaxMb)
  const [savingLimit, setSavingLimit] = useState(false)
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
    <section className="settings-panel">
      <header className="settings-panel-header">
        <h2>데이터 관리</h2>
        <p>이력 보관 용량과 설정 백업을 관리합니다.</p>
      </header>
      <div>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label htmlFor="history-size-limit">이력 DB 용량 상한</label>
          <select id="history-size-limit" className="rounded border border-input bg-background px-2 py-1" value={historyLimit} onChange={event => setHistoryLimit(event.target.value)} disabled={savingLimit}>
            <option value="1024">1GB</option>
            <option value="2048">2GB</option>
            <option value="5120">5GB</option>
            <option value="10240">10GB</option>
          </select>
          <Button size="sm" variant="outline" disabled={savingLimit} onClick={async () => {
            setSavingLimit(true)
            try {
              const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ historyMaxSizeMb: historyLimit }) })
              if (!response.ok) throw new Error('Save failed')
              toast.success('이력 DB 용량 상한을 저장했습니다')
            } catch { toast.error('용량 상한 저장에 실패했습니다') }
            finally { setSavingLimit(false) }
          }}>{savingLimit ? '저장 중...' : '용량 저장'}</Button>
        </div>
        <p className="mb-6 text-[20px] text-muted-foreground">90%부터 오래된 이력을 정리합니다. 장비 설정과 알람은 유지됩니다.</p>
        <h3 className="mb-4 border-t border-border pt-6 text-[24px] font-semibold">설정 백업 및 복원</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? '내보내는 중...' : '백업 내보내기'}
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
              {isImporting ? '복원 중...' : '백업 가져오기'}
            </Button>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-border pt-5">
          <p className="text-[20px] text-muted-foreground">초기화하면 등록 장비·설정·알람·이력이 삭제됩니다.</p>
          <Button
            variant={confirmReset ? 'destructive' : 'outline'}
            size="sm"
            className={confirmReset ? 'shrink-0' : 'shrink-0 text-destructive'}
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
      </div>
    </section>
  )
}
