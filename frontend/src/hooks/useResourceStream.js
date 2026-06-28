import { useEffect, useRef, useState } from 'react'
import { nodeBase } from '../lib/api'

// Returns the latest nodes for the selected target, a pulseKey that increments
// on every update (drives the StatusDot pulse), a `connected` flag, and an
// `unreachable` flag for paired secondaries that can't be reached.
//
// Local host (node=null): live WebSocket, auto-reconnecting. The browser sends
// the session cookie with the handshake automatically.
//
// Paired secondary (node=id): main has to proxy, and relaying a second live WS
// per node is more plumbing than it's worth — we poll the proxied one-shot
// /resources every 3s instead. A failed poll surfaces as `unreachable` so the
// UI degrades clearly (the M2 "Proxmox unavailable" pattern) rather than hanging.
export function useResourceStream(node) {
  const [nodes, setNodes] = useState(null) // null = haven't received first frame
  const [connected, setConnected] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [disconnected, setDisconnected] = useState(false) // debounced: down > 3s
  const [pulseKey, setPulseKey] = useState(0)
  const wsRef = useRef(null)

  // Debounce the visual "disconnected" state so a brief reconnect blip (the WS
  // backs off ~2s) doesn't flicker the whole dashboard. Only flag it after the
  // connection has been down for >3s; clear it the instant we're back.
  useEffect(() => {
    if (connected) { setDisconnected(false); return }
    const t = setTimeout(() => setDisconnected(true), 3000)
    return () => clearTimeout(t)
  }, [connected])

  useEffect(() => {
    setNodes(null)
    setConnected(false)
    setUnreachable(false)

    // --- secondary: poll the proxied snapshot ---
    if (node) {
      let stopped = false
      async function poll() {
        try {
          const r = await fetch(`${nodeBase(node)}/resources`, { credentials: 'same-origin' })
          if (!r.ok) throw new Error('unreachable')
          const snap = await r.json()
          if (stopped) return
          setNodes(snap.nodes ?? [])
          setConnected(true)
          setUnreachable(false)
          setPulseKey((k) => k + 1)
        } catch {
          if (stopped) return
          setConnected(false)
          setUnreachable(true)
        }
      }
      poll()
      const t = setInterval(poll, 3000)
      return () => { stopped = true; clearInterval(t) }
    }

    // --- local: live WebSocket ---
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
  }, [node])

  return { nodes, connected, pulseKey, unreachable, disconnected }
}
