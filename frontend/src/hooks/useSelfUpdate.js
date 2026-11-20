import { useState, useRef, useEffect, useCallback } from 'react'
import { triggerSelfUpdate, getVersion } from '../lib/api'

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 60000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeVersion(v) {
  return (v || '').trim().replace(/^v/, '')
}

// useSelfUpdate manages the one-click SimpDash self-update lifecycle:
//   idle -> confirm -> downloading -> restarting -> reloading (full reload)
//                                  -> error (retryable)
export function useSelfUpdate() {
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState(null)
  const [targetVersion, setTargetVersion] = useState(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  const askConfirm = useCallback(() => {
    setError(null)
    setPhase('confirm')
  }, [])

  const cancel = useCallback(() => {
    setError(null)
    setPhase('idle')
  }, [])

  const run = useCallback(async (expectedVersion, previousVersion) => {
    setError(null)
    setTargetVersion(expectedVersion || null)
    setPhase('downloading')

    let want = expectedVersion || ''
    try {
      const res = await triggerSelfUpdate()
      if (res?.target_version) {
        want = res.target_version
        setTargetVersion(want)
      }
    } catch (e) {
      if (cancelledRef.current) return
      setError(e?.message || 'Update failed')
      setPhase('error')
      return
    }

    if (cancelledRef.current) return
    setPhase('restarting')

    // Wait briefly for systemd to stop the old process before polling.
    await sleep(1000)

    const deadline = Date.now() + POLL_TIMEOUT_MS
    const wantNorm = normalizeVersion(want)
    const prevNorm = normalizeVersion(previousVersion)

    while (!cancelledRef.current && Date.now() < deadline) {
      try {
        const data = await getVersion()
        const gotNorm = normalizeVersion(data?.version)
        const matched = (wantNorm && gotNorm === wantNorm) || (prevNorm && gotNorm && gotNorm !== prevNorm)
        if (matched) {
          if (cancelledRef.current) return
          setPhase('reloading')
          try {
            const reg = await navigator.serviceWorker?.getRegistration()
            await reg?.update()
          } catch { /* ignore SW refresh errors */ }
          window.location.reload()
          return
        }
      } catch {
        // Expected while the server is restarting.
      }
      await sleep(POLL_INTERVAL_MS)
    }

    if (cancelledRef.current) return
    setError('SimpDash did not come back up within 60 seconds. Check `systemctl status simpdash` on the host, or reload the page manually.')
    setPhase('error')
  }, [])

  const busy = phase === 'downloading' || phase === 'restarting' || phase === 'reloading'

  return { phase, error, targetVersion, busy, askConfirm, cancel, run }
}
