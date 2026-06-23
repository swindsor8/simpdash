import { useState, useEffect, useRef } from 'react'
import { checkUpdates, applyUpdates } from '../lib/api'

export default function Updates() {
  const [checkState, setCheckState] = useState('idle') // idle | checking | done
  const [packages, setPackages] = useState(null) // null = not checked yet
  const [jobState, setJobState] = useState('idle') // idle | running | succeeded | failed
  const [output, setOutput] = useState([])
  const termRef = useRef(null)

  // Auto-scroll terminal to bottom on new output.
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [output])

  async function handleCheck() {
    setCheckState('checking')
    try {
      const data = await checkUpdates()
      setPackages(data.packages ?? [])
    } catch (e) {
      setPackages([])
      console.error('check updates:', e)
    } finally {
      setCheckState('done')
    }
  }

  async function handleUpgrade() {
    setJobState('running')
    setOutput([])
    let jobId
    try {
      const data = await applyUpdates()
      jobId = data.job_id
    } catch (e) {
      // 409 or other error
      setOutput([{ type: 'stderr', line: e.message }])
      setJobState('failed')
      return
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/jobs/${jobId}/stream`)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'done') {
          setJobState(msg.exit_code === 0 ? 'succeeded' : 'failed')
        } else {
          setOutput(prev => [...prev, msg])
        }
      } catch { /* ignore malformed frame */ }
    }
    ws.onerror = () => {
      setOutput(prev => [...prev, { type: 'stderr', line: '[stream error]' }])
      setJobState('failed')
    }
    ws.onclose = () => {
      // If still running when socket closes, mark failed.
      setJobState(prev => prev === 'running' ? 'failed' : prev)
    }
  }

  const busy = jobState === 'running'
  const hasPackages = packages !== null

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-300">System Updates</h2>
        <button
          onClick={handleCheck}
          disabled={checkState === 'checking' || busy}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-40 transition-colors"
        >
          {checkState === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {hasPackages && (
        <>
          {packages.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">System is up to date.</p>
          ) : (
            <div className="mb-4">
              <p className="text-sm text-gray-400 mb-2">
                <span className="text-white font-medium">{packages.length}</span> package{packages.length !== 1 ? 's' : ''} available
              </p>
              <div className="max-h-28 overflow-y-auto space-y-0.5">
                {packages.map(pkg => (
                  <div key={pkg} className="text-xs text-gray-500 font-mono">{pkg}</div>
                ))}
              </div>
            </div>
          )}

          {packages.length > 0 && (
            <button
              onClick={handleUpgrade}
              disabled={busy || jobState === 'succeeded'}
              className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors mb-4 ${
                busy
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : jobState === 'succeeded'
                  ? 'bg-green-900/50 text-green-400 cursor-default'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {busy ? 'Upgrading…' : jobState === 'succeeded' ? 'Done' : 'Apply updates'}
            </button>
          )}
        </>
      )}

      {output.length > 0 && (
        <div
          ref={termRef}
          className="bg-gray-950 border border-gray-800 rounded-lg p-3 h-56 overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {output.map((line, i) => (
            <div key={i} className={line.type === 'stderr' ? 'text-yellow-500' : 'text-gray-300'}>
              {line.line}
            </div>
          ))}
          {busy && (
            <div className="text-gray-600 animate-pulse">▌</div>
          )}
        </div>
      )}

      {jobState === 'failed' && output.length > 0 && (
        <p className="text-xs text-red-400 mt-2">Job exited with errors.</p>
      )}
    </div>
  )
}
