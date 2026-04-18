'use client'

import { useState, useEffect } from 'react'

const COMPACT_QUERY = '(max-height: 520px)'

export function useCompactScreen(): boolean {
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY)
    setCompact(mql.matches)

    const handler = (e: MediaQueryListEvent) => setCompact(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return compact
}
