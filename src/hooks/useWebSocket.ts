'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { WebSocketMessage } from '@/types'

const WS_URL = typeof window !== 'undefined'
  ? `ws://${window.location.hostname}:7778`
  : 'ws://localhost:7778'

const RECONNECT_DELAY = 3000

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

interface UseWebSocketReturn {
  connected: boolean
  reconnecting: boolean
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)

  // Store callbacks in refs to avoid reconnection on callback changes
  const onMessageRef = useRef(options.onMessage)
  const onConnectRef = useRef(options.onConnect)
  const onDisconnectRef = useRef(options.onDisconnect)

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = options.onMessage
    onConnectRef.current = options.onConnect
    onDisconnectRef.current = options.onDisconnect
  }, [options.onMessage, options.onConnect, options.onDisconnect])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setConnected(true)
        setReconnecting(false)
        console.log('[useWebSocket] Connected to', WS_URL)
        onConnectRef.current?.()
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          onMessageRef.current?.(message)
        } catch (error) {
          console.error('[useWebSocket] Parse error:', error)
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        wsRef.current = null
        onDisconnectRef.current?.()

        // Schedule reconnection
        setReconnecting(true)
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) {
            console.log('[useWebSocket] Reconnecting...')
            connect()
          }
        }, RECONNECT_DELAY)
      }

      ws.onerror = (error) => {
        console.error('[useWebSocket] Error:', error)
      }
    } catch (error) {
      console.error('[useWebSocket] Connection failed:', error)
      setReconnecting(true)
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect()
        }
      }, RECONNECT_DELAY)
    }
  }, [])  // No dependencies - connect function is stable

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return { connected, reconnecting }
}
