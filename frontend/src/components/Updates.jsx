import { useState, useEffect } from 'react'
import { checkUpdates, applyUpdates, cancelJob, getUpdatesPending } from '../lib/api'
import { useJobStream } from '../hooks/useJobStream'
import Terminal from './Terminal'
import { Card, StatusPill } from './Card'

function IconPackage() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 9.4 7.5 4.21M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  )
}

function IconRefresh({ spinning }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
    >
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-4"/>
    </svg>
  )
}

export default function Updates({ node = null }) {
  const [checkState, setCheckState] = useState('idle') // idle | checking | done
  const [packages, setPackages] = useState(null)
  const [details, setDetails] = useState([])
  const [rebootInfo, setRebootInfo] = useState({ required: false, packages: [] })
  const [showAll, setShowAll] = useState(false)
  const [distUpgrade, setDistUpgrade] = useState(false)
  const [checkErr, setCheckErr] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [startErr, setStartErr] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const { output, state: jobState, sendInput } = useJobStream(jobId, node)

  // Reset state when switching target nodes and read cached reboot-required flag.
  useEffect(() => {
    setPackages(null)
    setDetails([])
    setShowAll(false)
    setCheckErr(null)
    setJobId(null)
    setStartErr(null)
    let live = true
    getUpdatesPending(node)
      .then((d) => {
        if (live) setRebootInfo({ required: Boolean(d?.reboot_required), packages: d?.reboot_packages ?? [] })
      })
      .catch(() => {})
    return () => { live = false }
  }, [node])

  async function handleCheck() {
    setCheckState('checking')
    setCheckErr(null)
    setShowAll(false)
    try {
      const data = await checkUpdates(node)
      setPackages(data.packages ?? [])
      setDetails(Array.isArray(data.package_details) ? data.package_details : [])
      setRebootInfo({ required: Boolean(data.reboot_required), packages: data.reboot_packages ?? [] })
    } catch (e) {
      // Don't fake "up to date" on a failed check — say the check failed.
      setPackages(null)
      setDetails([])
      setCheckErr(e.message)
    } finally {
      setCheckState('done')
    }
  }

  async function handleUpgrade() {
    setStartErr(null)
    try {
      const data = await applyUpdates(node, { dist_upgrade: distUpgrade })
      setJobId(data.job_id)
    } catch (e) {
      setStartErr(e.message)
    }
  }

  async function handleCancel() {
    if (!jobId) return
    setCancelling(true)
    try {
      await cancelJob(jobId, node)
    } catch (e) {
      setStartErr(e.message)
    } finally {
      setCancelling(false)
    }
  }

  const busy = jobState === 'running'
  const rows = details.length > 0
    ? details
    : (packages ?? []).map((name) => ({ name }))
  const visibleRows = showAll ? rows : rows.slice(0, 8)
  const securityCount = rows.filter(r => r.security).length

  return (
    <Card
      className="overflow-hidden"
      icon={<IconPackage />}
      title="System Updates"
      subtitle="apt package upgrades"
      action={
        <div className="flex items-center gap-2">
          {rebootInfo.required && (
            <StatusPill
              variant="warning"
              title={rebootInfo.packages.length > 0 ? `Reboot required by: ${rebootInfo.packages.join(', ')}` : 'Host requires a reboot'}
            >
              Reboot required
            </StatusPill>
          )}
          <button
            onClick={handleCheck}
            disabled={checkState === 'checking' || busy}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors"
          >
            <IconRefresh spinning={checkState === 'checking'} />
            {checkState === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      }
    >
      {/* Reboot required notice */}
      {rebootInfo.required && (
        <div className="px-6 py-3 border-b border-white/[0.06] bg-amber-500/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs text-amber-300">
          <span>
            Host kernel/system libraries were upgraded — reboot this node when convenient.
            {rebootInfo.packages.length > 0 && (
              <span className="text-amber-400/80 font-mono ml-1.5">({rebootInfo.packages.slice(0, 4).join(', ')}{rebootInfo.packages.length > 4 ? ` +${rebootInfo.packages.length - 4}` : ''})</span>
            )}
          </span>
        </div>
      )}

      {/* Check failed — surfaced honestly instead of a false "up to date". */}
      {checkErr && (
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <p className="text-sm text-red-400">Couldn't check for updates: {checkErr}</p>
        </div>
      )}

      {/* Package list */}
      {packages !== null && (
        <div className="px-6 py-4 border-b border-white/[0.06]">
          {packages.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">System is up to date.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <p className="text-sm text-gray-400">
                    <span className="text-white font-semibold">{packages.length}</span>
                    {' '}package{packages.length !== 1 ? 's' : ''} available
                  </p>
                  {securityCount > 0 && (
                    <StatusPill variant="warning">{securityCount} security</StatusPill>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {!busy && jobState !== 'succeeded' && (
                    <>
                      <label
                        className="inline-flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none"
                        title="Proxmox VE recommends dist-upgrade so kernel and PVE packages aren't held back"
                      >
                        <input
                          type="checkbox"
                          checked={distUpgrade}
                          onChange={e => setDistUpgrade(e.target.checked)}
                          className="accent-blue-500"
                        />
                        dist-upgrade (PVE)
                      </label>
                      <button
                        onClick={handleUpgrade}
                        className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
                      >
                        {distUpgrade ? 'Run dist-upgrade' : 'Apply updates'}
                      </button>
                    </>
                  )}
                  {busy && (
                    <>
                      <StatusPill variant="neutral">Upgrading…</StatusPill>
                      <button
                        onClick={handleCancel}
                        disabled={cancelling}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                      >
                        {cancelling ? 'Stopping…' : 'Cancel'}
                      </button>
                    </>
                  )}
                  {jobState === 'succeeded' && <StatusPill variant="success">Done</StatusPill>}
                  {jobState === 'cancelled' && <StatusPill variant="warning">Cancelled</StatusPill>}
                </div>
              </div>

              {/* Package table */}
              <div className="border border-white/[0.06] rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left text-xs text-gray-600 font-medium px-4 py-2.5 w-10">#</th>
                      <th className="text-left text-xs text-gray-600 font-medium px-4 py-2.5">Package</th>
                      {details.length > 0 && (
                        <th className="text-right text-xs text-gray-600 font-medium px-4 py-2.5 hidden sm:table-cell">Version</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((pkg, i) => (
                      <tr key={pkg.name} className="border-t border-white/[0.04]">
                        <td className="px-4 py-2 text-xs text-gray-600 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2 text-sm text-gray-300 font-mono">
                          <span className="inline-flex items-center gap-2">
                            {pkg.name}
                            {pkg.security && (
                              <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                security
                              </span>
                            )}
                          </span>
                        </td>
                        {details.length > 0 && (
                          <td className="px-4 py-2 text-xs text-gray-500 font-mono text-right hidden sm:table-cell">
                            {pkg.current ? `${pkg.current} → ` : ''}<span className="text-gray-300">{pkg.candidate || '—'}</span>
                          </td>
                        )}
                      </tr>
                    ))}
                    {rows.length > 8 && (
                      <tr className="border-t border-white/[0.04]">
                        <td colSpan={details.length > 0 ? 3 : 2} className="px-4 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => setShowAll(v => !v)}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            {showAll ? 'Show fewer packages' : `Show all ${rows.length} packages (+${rows.length - 8} more)`}
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Terminal output */}
      {(output.length > 0 || startErr) && (
        <div className="px-6 py-4">
          {startErr && <p className="text-xs text-red-400 mb-2">{startErr}</p>}
          <Terminal output={output} state={jobState} sendInput={sendInput} />
        </div>
      )}

      {/* Empty state */}
      {packages === null && !checkErr && (
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-gray-600">Click "Check for updates" to scan for available apt packages.</p>
        </div>
      )}
    </Card>
  )
}
