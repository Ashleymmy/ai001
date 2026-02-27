/**
 * useWorkspaceWebSocket — React hook for workspace collaboration WebSocket.
 *
 * Connects to /ws/workspace/{workspaceId} with the stored access_token,
 * handles heartbeat, dispatches incoming events to callbacks, and
 * manages reconnection with exponential back-off.
 */

import { useEffect, useRef } from 'react'
import { BACKEND_ORIGIN, getStoredAccessToken } from '../services/api'

export interface WorkspaceWSEvent {
  type: string
  [key: string]: unknown
}

export interface OnlineMember {
  user_id: string
  user_name: string
}

interface UseWorkspaceWebSocketOptions {
  workspaceId: string | null | undefined
  enabled?: boolean
  onEvent?: (event: WorkspaceWSEvent) => void
  onOnlineMembersChange?: (members: OnlineMember[]) => void
  heartbeatIntervalMs?: number
  reconnectMaxMs?: number
}

export function useWorkspaceWebSocket({
  workspaceId,
  enabled = true,
  onEvent,
  onOnlineMembersChange,
  heartbeatIntervalMs = 30_000,
  reconnectMaxMs = 30_000,
}: UseWorkspaceWebSocketOptions): void {
  const onEventRef = useRef(onEvent)
  const onOnlineMembersRef = useRef(onOnlineMembersChange)

  // Keep callback refs up to date
  onEventRef.current = onEvent
  onOnlineMembersRef.current = onOnlineMembersChange

  useEffect(() => {
    if (!workspaceId || !enabled) return

    const token = getStoredAccessToken()
    if (!token) return

    let ws: WebSocket | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    let disposed = false

    function connect(): void {
      if (disposed) return

      const wsBase = BACKEND_ORIGIN.replace(/^http/, 'ws')
      const url = `${wsBase}/ws/workspace/${workspaceId}?access_token=${encodeURIComponent(token)}`

      ws = new WebSocket(url)

      ws.onopen = () => {
        reconnectAttempt = 0
        heartbeatTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }))
          }
        }, heartbeatIntervalMs)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WorkspaceWSEvent
          if (
            (data.type === 'member_online' || data.type === 'member_offline') &&
            Array.isArray(data.online_members)
          ) {
            onOnlineMembersRef.current?.(data.online_members as OnlineMember[])
          }
          onEventRef.current?.(data)
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        ws = null

        if (!disposed) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt++), reconnectMaxMs)
          reconnectTimer = setTimeout(connect, delay)
        }
      }

      ws.onerror = () => {
        // onclose will fire and handle reconnect
      }
    }

    connect()

    return () => {
      disposed = true
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [workspaceId, enabled, heartbeatIntervalMs, reconnectMaxMs])
}
