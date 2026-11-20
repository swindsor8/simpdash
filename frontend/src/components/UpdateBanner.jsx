import { useState, useEffect } from 'react'
import { getUpdateCheck } from '../lib/api'
import { useSelfUpdate } from '../hooks/useSelfUpdate'

// The one-liner that re-installs SimpDash in place (see scripts/install.sh).
export const INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/swindsor8/simpdash/main/scripts/install.sh | bash'

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-emerald-300 shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
    </svg>
  )
}

// UpdateBanner checks /api/update-check once on mount and, when a newer release
// exists, offers a one-click self-update button (when supported by the release)
// with a manual CLI command fallback.
export default function UpdateBanner() {
  const [info, setInfo] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [showCli, setShowCli] = useState(false)
  const [copied, setCopied] = useState(false)
  const updater = useSelfUpdate()

  useEffect(() => {
    getUpdateCheck().then(setInfo).catch(() => {})
  }, [])

  if (dismissed || !info?.update_available) return null

  const canAuto = !!info.can_self_update
  const cliVisible = !canAuto || showCli

  function copy() {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 sm:px-8 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm text-emerald-300 min-w-0">
          {updater.busy && <Spinner />}
          <p className="truncate">
            {updater.phase === 'downloading' && (
              <>Downloading &amp; verifying <span className="font-semibold">{updater.targetVersion || info.latest_version}</span>…</>
            )}
            {updater.phase === 'restarting' && (
              <>Restarting SuperDash — waiting for <span className="font-semibold">{updater.targetVersion || info.latest_version}</span>…</>
            )}
            {updater.phase === 'reloading' && (
              <>Updated to <span className="font-semibold">{updater.targetVersion || info.latest_version}</span> — reloading…</>
            )}
            {!updater.busy && (
              <>
                <span className="font-semibold">{info.latest_version}</span> is available
                <span className="text-emerald-400/60"> — you're on {info.current_version}</span>
                {info.release_url && (
                  <>
                    {' · '}
                    <a
                      href={info.release_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline underline-offset-2 text-emerald-300/80 hover:text-emerald-200"
                    >
                      Release notes
                    </a>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canAuto && updater.phase === 'idle' && (
            <button
              onClick={updater.askConfirm}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
            >
              Update to {info.latest_version}
            </button>
          )}

          {canAuto && updater.phase === 'confirm' && (
            <>
              <span className="text-xs text-emerald-300/80 hidden sm:inline">
                SuperDash will briefly restart (~5 s).
              </span>
              <button
                onClick={() => updater.run(info.latest_version, info.current_version)}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
              >
                Confirm update
              </button>
              <button
                onClick={updater.cancel}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {canAuto && updater.phase === 'error' && (
            <button
              onClick={() => updater.run(info.latest_version, info.current_version)}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
            >
              Retry
            </button>
          )}

          {canAuto && !updater.busy && (
            <button
              onClick={() => setShowCli(v => !v)}
              className="text-xs text-emerald-400/70 hover:text-emerald-300 transition-colors px-1.5 py-1"
            >
              {showCli ? 'Hide CLI' : 'Manual CLI'}
            </button>
          )}

          {!updater.busy && (
            <button
              onClick={() => setDismissed(true)}
              className="text-xs text-emerald-400/60 hover:text-emerald-300 transition-colors pl-1"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>

      {updater.error && (
        <p className="text-xs text-red-400 mt-2">{updater.error}</p>
      )}

      {cliVisible && !updater.busy && (
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
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
      )}
    </div>
  )
}
