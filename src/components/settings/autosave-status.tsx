import type { AutosaveStatus as Status } from '@/lib/settings-autosave'

export function AutosaveStatus({ status, error, id }: { status: Status; error?: string | null; id?: string }) {
  const message = status === 'invalid' ? error : {
    idle: '변경 시 자동 저장',
    pending: '입력 내용 저장 대기',
    saving: '저장 중...',
    saved: '자동 저장됨',
    error: '저장 실패 · 자동 재시도 중',
  }[status]
  return <span id={id} role="status" className="settings-save-status" data-status={status}>{message}</span>
}
