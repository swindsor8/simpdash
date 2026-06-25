import { useState, useEffect } from 'react'
import { getUpdateCheck } from '../lib/api'

// The one-liner that re-installs SimpDash in place (see scripts/install.sh).
const INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/swindsor8/simpdash/main/scripts/install.sh | bash'

// UpdateBanner polls /api/update-check once on mount and, when a newer release
// exists, shows a dismissible banner with the copyable update command. No
// auto-update — the admin runs the command when they choose.
export default function UpdateBanner() {
  const [info, setInfo] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getUpdateCheck().then(setInfo).catch(() => {})
  }, [])

  if (dismissed || !info?.update_available) return null

  function copy() {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-8 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-emerald-300">
          <span className="font-semibold">{info.latest_version}</span> is available
          <span className="text-emerald-400/60"> — you're on {info.current_version}</span>
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-xs text-emerald-400/60 hover:text-emerald-300 transition-colors"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 bg-[#0c0c14] border border-emerald-500/15 rounded-lg px-3 py-2 text-xs text-emerald-200 font-mono overflow-x-auto whitespace-nowrap">
          {INSTALL_CMD}
        </code>
        <button
          onClick={copy}
          className="shrink-0 text-xs px-3 py-2 rounded-lg border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[11px] text-emerald-400/50 mt-1.5">
        Re-running the installer is safe — it updates in place and won't repeat onboarding.
      </p>
    </div>
  )
}
