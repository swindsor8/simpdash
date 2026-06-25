import { useState } from 'react'
import { checkUpdates, applyUpdates } from '../lib/api'
import { useJobStream } from '../hooks/useJobStream'
import Terminal from './Terminal'

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
  const [checkErr, setCheckErr] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [startErr, setStartErr] = useState(null)
  const { output, state: jobState } = useJobStream(jobId, node)

  async function handleCheck() {
    setCheckState('checking')
    setCheckErr(null)
    try {
      const data = await checkUpdates(node)
      setPackages(data.packages ?? [])
    } catch (e) {
      // Don't fake "up to date" on a failed check — say the check failed.
      setPackages(null)
      setCheckErr(e.message)
    } finally {
      setCheckState('done')
    }
  }

  async function handleUpgrade() {
    setStartErr(null)
    try {
      const data = await applyUpdates(node)
      setJobId(data.job_id)
    } catch (e) {
      setStartErr(e.message)
    }
  }

  const busy = jobState === 'running'

  return (
    <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl overflow-hidden">

      {/* Card header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div>
          <h2 className="text-sm font-semibold text-white">System Updates</h2>
          <p className="text-xs text-gray-500 mt-0.5">apt package upgrades</p>
        </div>
        <button
          onClick={handleCheck}
          disabled={checkState === 'checking' || busy}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors"
        >
          <IconRefresh spinning={checkState === 'checking'} />
          {checkState === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

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
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-400">
                  <span className="text-white font-semibold">{packages.length}</span>
                  {' '}package{packages.length !== 1 ? 's' : ''} available
                </p>
                {!busy && jobState !== 'succeeded' && (
                  <button
                    onClick={handleUpgrade}
                    className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
                  >
                    Apply updates
                  </button>
                )}
                {busy && (
                  <span className="text-xs px-4 py-1.5 rounded-lg bg-white/8 text-gray-400">
                    Upgrading…
                  </span>
                )}
                {jobState === 'succeeded' && (
                  <span className="text-xs px-4 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 font-medium">
                    Done
                  </span>
                )}
              </div>

              {/* Package table */}
              <div className="border border-white/[0.06] rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left text-xs text-gray-600 font-medium px-4 py-2.5">#</th>
                      <th className="text-left text-xs text-gray-600 font-medium px-4 py-2.5">Package</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packages.slice(0, 8).map((pkg, i) => (
                      <tr key={pkg} className="border-t border-white/[0.04]">
                        <td className="px-4 py-2.5 text-xs text-gray-600 tabular-nums w-10">{i + 1}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-300 font-mono">{pkg}</td>
                      </tr>
                    ))}
                    {packages.length > 8 && (
                      <tr className="border-t border-white/[0.04]">
                        <td colSpan={2} className="px-4 py-2.5 text-xs text-gray-600 text-center">
                          +{packages.length - 8} more packages
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
          <Terminal output={output} state={jobState} />
        </div>
      )}

      {/* Empty state */}
      {packages === null && !checkErr && (
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-gray-600">Click "Check for updates" to scan for available apt packages.</p>
        </div>
      )}

    </div>
  )
}
