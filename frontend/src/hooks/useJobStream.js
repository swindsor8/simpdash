import { useState, useEffect, useRef, useCallback } from 'react'

// useJobStream connects to a job's output stream and accumulates frames. Pass a
// falsy jobId to stay idle. `node` (a paired node id, or null for local) selects
// whether the stream is local or relayed through main from a secondary.
//
// Returns { output, state, sendInput } where state is
// 'idle' | 'running' | 'succeeded' | 'failed'. sendInput(str) writes keystrokes
// back to an interactive (PTY) job's stdin. Shared by the Updates and Scripts
// views so the live terminal behaves identically in both.
export function useJobStream(jobId, node) {
  const [output, setOutput] = useState([])
  const [state, setState] = useState('idle')
  const wsRef = useRef(null)

  useEffect(() => {
    if (!jobId) return
    setOutput([])
    setState('running')

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = node ? `/api/nodes/${encodeURIComponent(node)}` : '/api'
    const ws = new WebSocket(`${proto}://${location.host}${base}/jobs/${jobId}/stream`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'done') {
          setState(msg.exit_code === 0 ? 'succeeded' : 'failed')
        } else {
          setOutput(prev => [...prev, msg])
        }
      } catch { /* ignore malformed frame */ }
    }
    ws.onerror = () => {
      setOutput(prev => [...prev, { type: 'stderr', line: '[stream error]' }])
      setState('failed')
    }
    ws.onclose = () => {
      // If we never saw a "done" frame, treat the drop as a failure.
      setState(prev => (prev === 'running' ? 'failed' : prev))
    }

    return () => { wsRef.current = null; ws.close() }
  }, [jobId, node])

  const sendInput = useCallback((data) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
  }, [])

  return { output, state, sendInput }
}
