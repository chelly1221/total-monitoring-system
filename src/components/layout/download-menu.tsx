'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DownloadInfo } from '@/lib/downloads'

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Header 다운로드 menu: lists the client programs the server can hand out.
 * The list is fetched when the menu opens so newly dropped files show up
 * without a reload. Items missing on the server are shown disabled.
 *
 * In a browser the item is a plain download link. Inside the desktop app
 * WebView2 saves link downloads silently (no bar, no prompt), which looks like
 * nothing happened; there we ask the Rust side to show a native "다른 이름으로
 * 저장" dialog and copy the file to the chosen location instead.
 */
export function DownloadMenu() {
  const [items, setItems] = useState<DownloadInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTauri, setIsTauri] = useState(false)

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)
  }, [])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/downloads', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setItems(data.items as DownloadInfo[])
    } catch {
      setError('목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  const saveInApp = async (item: DownloadInfo) => {
    setSaving(item.id)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke<string | null>('save_download', { file: item.file })
      if (path === null) return // user cancelled the save dialog
      toast.success(`${item.name} 저장 완료`, { description: path })
    } catch (e) {
      toast.error(`${item.name} 저장 실패`, { description: String(e) })
    } finally {
      setSaving(null)
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void load() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="클라이언트 프로그램 다운로드">
          <Download className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center gap-2">
          클라이언트 프로그램
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {error && <div className="px-2 py-1.5 text-xs text-destructive">{error}</div>}
        {items?.map((item) => {
          if (!item.available) {
            return (
              <DropdownMenuItem key={item.id} disabled className="flex flex-col items-start gap-0.5">
                <span className="font-medium">{item.name}</span>
                <span className="text-xs">파일이 서버에 없습니다 ({item.file})</span>
              </DropdownMenuItem>
            )
          }
          const body = (
            <>
              <span className="font-medium flex items-center gap-1">
                {item.name}
                {item.version && <span className="text-xs text-muted-foreground">v{item.version}</span>}
                {saving === item.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </span>
              <span className="text-xs text-muted-foreground">{item.description}</span>
              <span className="text-[10px] text-muted-foreground">
                {item.file}
                {item.size !== null && <> · {formatSize(item.size)}</>}
              </span>
            </>
          )
          return isTauri ? (
            <DropdownMenuItem
              key={item.id}
              className="flex flex-col items-start gap-0.5"
              disabled={saving !== null}
              onSelect={() => void saveInApp(item)}
            >
              {body}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.id} asChild>
              <a
                href={`/api/downloads/${item.id}`}
                download={item.file}
                className="flex flex-col items-start gap-0.5"
                onClick={() => toast.success(`${item.name} 다운로드를 시작했습니다`)}
              >
                {body}
              </a>
            </DropdownMenuItem>
          )
        })}
        {items && items.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">등록된 프로그램이 없습니다</div>
        )}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[10px] text-muted-foreground">
          {isTauri
            ? '저장 위치를 고르는 창이 열립니다. 저장한 파일을 시설 PC로 옮겨 압축을 풀고 실행하면 됩니다.'
            : '시설 PC의 브라우저에서 이 화면을 열어 내려받으면 됩니다.'}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
