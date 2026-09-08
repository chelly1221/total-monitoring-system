'use client'

import { useSyncExternalStore } from 'react'

const COMPACT_QUERY = '(max-height: 520px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useCompactScreen(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COMPACT_QUERY).matches, () => false)
}
