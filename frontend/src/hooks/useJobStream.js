import { useState, useEffect } from 'react'

// useJobStream connects to a job's output stream and accumulates frames. Pass a
// falsy jobId to stay idle. `node` (a paired node id, or null for local) selects
// whether the stream is local or relayed through main from a secondary.
//
// Returns { output, state } where state is
// 'idle' | 'running' | 'succeeded' | 'failed'. Shared by the Updates and
// Scripts views so the live terminal behaves identically in both.
export function useJobStream(jobId, node) {
  const [output, setOutput] = useState([])
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (!jobId) return
    setOutput([])
    setState('running')

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = node ? `/api/nodes/${encodeURIComponent(node)}` : '/api'
    const ws = new WebSocket(`${proto}://${location.host}${base}/jobs/${jobId}/stream`)

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

    return () => ws.close()
  }, [jobId, node])

  return { output, state }
}
