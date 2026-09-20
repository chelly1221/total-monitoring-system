'use client'

import { useCallback, useEffect, useRef, useState, startTransition } from 'react'
import { useWebSocket } from './useWebSocket'
import type { WebSocketMessage } from '@/types'

const EMPTY_MESSAGES: string[] = []

// Bound both the pending buffer and rendering frequency while a user edits a form.
export function useRawPreview(port: string, limit: number) {
  const portNumber = Number(port)
  const valid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
  const pending = useRef<string[]>([])
  const [preview, setPreview] = useState({ portNumber, messages: EMPTY_MESSAGES })
  const onMessage = useCallback((message: WebSocketMessage) => {
    if (valid && message.type === 'raw' && message.data?.port === portNumber && typeof message.data.rawData === 'string') {
      pending.current.push(message.data.rawData)
      if (pending.current.length > limit) pending.current.splice(0, pending.current.length - limit)
    }
  }, [valid, portNumber, limit])
  const { connected } = useWebSocket({ onMessage })

  useEffect(() => {
    pending.current = []
    const timer = setInterval(() => {
      if (!pending.current.length) return
      const batch = pending.current
      pending.current = []
      startTransition(() => setPreview(previous => ({
        portNumber,
        messages: [...(previous.portNumber === portNumber ? previous.messages : []), ...batch].slice(-limit),
      })))
    }, 250)
    return () => clearInterval(timer)
  }, [portNumber, limit])

  return { messages: preview.portNumber === portNumber ? preview.messages : EMPTY_MESSAGES, connected: valid && connected }
}
