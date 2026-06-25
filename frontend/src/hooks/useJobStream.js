import { useState, useEffect } from 'react'

// useJobStream connects to /api/jobs/:id/stream for the given job and
// accumulates output frames. Pass a falsy jobId to stay idle.
//
// Returns { output, state } where state is
// 'idle' | 'running' | 'succeeded' | 'failed'. Shared by the Updates and
// Scripts views so the live terminal behaves identically in both.
export function useJobStream(jobId) {
  const [output, setOutput] = useState([])
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (!jobId) return
    setOutput([])
    setState('running')

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/jobs/${jobId}/stream`)

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
  }, [jobId])

  return { output, state }
}
