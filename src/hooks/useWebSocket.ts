'use client'

import { useEffect, useRef, useState } from 'react'
import type { WebSocketMessage } from '@/types'

const RECONNECT_DELAY = 3000

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

export function useWebSocket(options: UseWebSocketOptions = {}): { connected: boolean; reconnecting: boolean } {
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const callbacks = useRef(options)
  useEffect(() => { callbacks.current = options }, [options])

  useEffect(() => {
    // Each effect owns its socket and timer. A close event from the previous
    // StrictMode mount must never clear or reconnect the current socket.
    let disposed = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${scheme}://${window.location.hostname}:${process.env.NEXT_PUBLIC_WS_PORT || '7778'}`

    function reconnect() {
      if (disposed) return
      setConnected(false)
      setReconnecting(true)
      clearTimeout(timer)
      timer = setTimeout(connect, RECONNECT_DELAY)
    }

    function connect() {
      if (disposed || (socket && socket.readyState < WebSocket.CLOSING)) return
      try {
        const ws = new WebSocket(url)
        socket = ws
        ws.onopen = () => {
          if (disposed || socket !== ws) return
          setConnected(true)
          setReconnecting(false)
          callbacks.current.onConnect?.()
        }
        ws.onmessage = (event) => {
          if (disposed || socket !== ws) return
          try {
            callbacks.current.onMessage?.(JSON.parse(event.data))
          } catch (error) {
            console.error('[useWebSocket] Message error:', error)
          }
        }
        ws.onclose = () => {
          if (disposed || socket !== ws) return
          socket = null
          callbacks.current.onDisconnect?.()
          reconnect()
        }
        ws.onerror = () => ws.close()
      } catch (error) {
        console.error('[useWebSocket] Connection failed:', error)
        socket = null
        reconnect()
      }
    }

    connect()
    return () => {
      disposed = true
      clearTimeout(timer)
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
        socket.close()
        socket = null
      }
    }
  }, [])

  return { connected, reconnecting }
}
