'use client'

import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { windowHref } from '@/lib/window-href'

export function useWindowHref() {
  const standalone = useSearchParams().get('standalone') === 'true'
  return useCallback((href: string) => windowHref(href, standalone), [standalone])
}
