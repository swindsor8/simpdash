import { useState, useEffect, useRef } from 'react'
import { getUpdateCheck } from '../lib/api'
import { useSelfUpdate } from '../hooks/useSelfUpdate'
import { Expandable, usePopPulse } from './motion'

// The one-liner that re-installs SuperDash in place (see scripts/install.sh).
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

function IconArrowUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

// UpdateHeaderPill renders a compact emerald notification pill in the header
// bar whenever a newer SuperDash release is available. Clicking it toggles the
// full UpdateBanner drawer with one-click install controls.
export function UpdateHeaderPill({ info, open, onClick, compact = false }) {
  if (!info?.update_available) return null

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={`SuperDash ${info.latest_version} is available (currently on ${info.current_version})`}
      className={`items-center gap-1.5 rounded-full border text-xs font-medium transition-colors shrink-0 ${
        compact ? 'inline-flex px-2.5 py-1' : 'hidden md:inline-flex px-3 py-1'
      } ${
        open
          ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-200'
          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-400/40'
      }`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
      <IconArrowUp />
      <span>{compact ? info.latest_version : `Update ${info.latest_version}`}</span>
    </button>
  )
}

// UpdateBanner shows the expandable update bar with a one-click self-update
// button (when supported by the release) and a manual CLI command fallback.
// Pass `info` + `open` + `onClose` from Dashboard so it pairs with the header pill.
export default function UpdateBanner({ info: propInfo, open = true, onClose }) {
  const [fetchedInfo, setFetchedInfo] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [showCli, setShowCli] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyBtnRef = useRef(null)
  const updater = useSelfUpdate()
  usePopPulse(copyBtnRef, copied)

  useEffect(() => {
    if (propInfo !== undefined) return
    getUpdateCheck().then(setFetchedInfo).catch(() => {})
  }, [propInfo])

  const info = propInfo !== undefined ? propInfo : fetchedInfo
  const isControlled = onClose !== undefined
  const visible = Boolean(info?.update_available) && (isControlled ? (open || updater.busy) : !dismissed)

  const canAuto = Boolean(info?.can_self_update)
  const cliVisible = !canAuto || showCli

  function close() {
    if (onClose) onClose()
    else setDismissed(true)
  }

  function copy() {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Expandable open={visible}>
    {info && (
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
              onClick={close}
              className="text-xs text-emerald-400/60 hover:text-emerald-300 transition-colors pl-1"
            >
              {isControlled ? 'Hide' : 'Dismiss'}
            </button>
          )}
        </div>
      </div>

      {updater.error && (
        <p className="text-xs text-red-400 mt-2">{updater.error}</p>
      )}

      <Expandable open={cliVisible && !updater.busy}>
        <div className="mt-2.5">
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[#0c0c14] border border-emerald-500/15 rounded-lg px-3 py-2 text-xs text-emerald-200 font-mono overflow-x-auto whitespace-nowrap">
              {INSTALL_CMD}
            </code>
            <button
              ref={copyBtnRef}
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
      </Expandable>
    </div>
    )}
    </Expandable>
  )
}
