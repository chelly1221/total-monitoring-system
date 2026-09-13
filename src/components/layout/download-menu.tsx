'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DownloadInfo } from '@/lib/downloads'

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
      <DropdownMenuContent align="end" className="w-max min-w-[320px] max-w-[calc(100vw-24px)] rounded-[6px] p-[4px]" style={{ fontFamily: 'var(--font-pretendard), sans-serif' }}>
        {loading && !items && <div role="status" className="px-[12px] py-[10px] text-[15px] text-muted-foreground">목록을 불러오는 중...</div>}
        {error && <div role="alert" className="px-[12px] py-[10px] text-[15px] text-destructive">{error}</div>}
        {items?.map((item) => {
          const rowClassName = 'flex min-w-0 items-center gap-[12px] whitespace-nowrap rounded-[4px] px-[12px] py-[10px] text-[17px] leading-[1.4]'
          const body = (
            <>
              <span className="truncate font-medium">{item.name}</span>
              {item.version && <span className="ml-auto shrink-0 text-[15px] tabular-nums text-muted-foreground">v{item.version}</span>}
              {saving === item.id && <Loader2 className="size-[15px] shrink-0 animate-spin text-muted-foreground" />}
            </>
          )
          if (!item.available) {
            return (
              <DropdownMenuItem key={item.id} disabled className={rowClassName} aria-label={`${item.name} ${item.version ? `v${item.version} ` : ''}(파일 없음)`}>
                {body}
              </DropdownMenuItem>
            )
          }
          return isTauri ? (
            <DropdownMenuItem
              key={item.id}
              className={rowClassName}
              title={item.name}
              disabled={saving !== null}
              onSelect={() => void saveInApp(item)}
            >
              {body}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.id} asChild className={rowClassName}>
              <a
                href={`/api/downloads/${item.id}`}
                download={item.file}
                title={item.name}
                onClick={() => toast.success(`${item.name} 다운로드를 시작했습니다`)}
              >
                {body}
              </a>
            </DropdownMenuItem>
          )
        })}
        {items && items.length === 0 && (
          <div className="px-[12px] py-[10px] text-[15px] text-muted-foreground">등록된 프로그램이 없습니다</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
