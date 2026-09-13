'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { orderCards, readCardOrder } from '@/lib/card-order'

const CHANGE_EVENT = 'tms-card-order-changed'
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(CHANGE_EVENT, notify)
  return () => {
    window.removeEventListener('storage', notify)
    window.removeEventListener(CHANGE_EVENT, notify)
  }
}

export function useCardOrder<T extends { id: string }>(group: string, items: T[]) {
  const key = `tms:card-order:${group}:v1`
  const snapshot = useCallback(() => {
    try { return localStorage.getItem(key) ?? '[]' } catch { return '[]' }
  }, [key])
  const raw = useSyncExternalStore(subscribe, snapshot, () => '[]')
  function save(ids: string[]) {
    try {
      localStorage.setItem(key, JSON.stringify(ids))
      window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch { toast.error('카드 순서를 저장하지 못했습니다. 저장 공간을 확인하세요.') }
  }
  return { items: orderCards(items, readCardOrder(raw)), save, reset: () => save([]) }
}
