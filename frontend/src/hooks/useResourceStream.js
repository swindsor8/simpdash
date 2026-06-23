import { useEffect, useRef, useState } from 'react'

// Connects to the live resource WebSocket and returns the latest nodes plus a
// pulseKey that increments on every update (drives the StatusDot pulse), and a
// connected flag. Auto-reconnects on drop. The browser sends the session cookie
// with the WS handshake automatically, so no token plumbing here.
export function useResourceStream() {
  const [nodes, setNodes] = useState(null) // null = haven't received first frame
  const [connected, setConnected] = useState(false)
  const [pulseKey, setPulseKey] = useState(0)
  const wsRef = useRef(null)

  useEffect(() => {
    let closed = false
    let retry

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/resources/stream`)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onmessage = (e) => {
        try {
          const snap = JSON.parse(e.data)
          setNodes(snap.nodes ?? [])
          setPulseKey((k) => k + 1)
        } catch {
          /* ignore malformed frame */
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 2000) // reconnect with backoff
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [])

  return { nodes, connected, pulseKey }
}
