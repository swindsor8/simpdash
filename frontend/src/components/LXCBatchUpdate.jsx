import { useState, useEffect, useMemo } from 'react'
import { getLXCUpdateExcludes, putLXCUpdateExcludes, updateAllContainers } from '../lib/api'
import { useJobStream } from '../hooks/useJobStream'
import Terminal from './Terminal'
import { Card, StatusPill } from './Card'
import { Expandable } from './motion'

function IconContainers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="6" rx="1.5" />
      <rect x="2" y="13" width="20" height="8" rx="1.5" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
    </svg>
  )
}

function Spinner({ className = 'text-blue-400' }) {
  return (
    <svg className={`animate-spin h-3.5 w-3.5 shrink-0 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
    </svg>
  )
}

function fmtDuration(ms) {
  if (!ms || ms < 1000) return ms ? `${ms} ms` : ''
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)}s`
  const mins = Math.floor(secs / 60)
  const rem = Math.round(secs % 60)
  return `${mins}m ${rem}s`
}

function RowBadge({ item }) {
  switch (item.status) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-300">
          <Spinner />
          Updating…
        </span>
      )
    case 'succeeded':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Updated{item.duration_ms ? ` · ${fmtDuration(item.duration_ms)}` : ''}
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Failed{item.exit_code != null ? ` (exit ${item.exit_code})` : ''}
        </span>
      )
    case 'skipped':
      return (
        <span className="text-xs text-gray-600">
          Skipped{item.reason ? ` · ${item.reason}` : ''}
        </span>
      )
    default:
      return <span className="text-xs text-gray-500">Queued</span>
  }
}

export default function LXCBatchUpdate({ lxcs = [] }) {
  const [excluded, setExcluded] = useState([])
  const [excludesOpen, setExcludesOpen] = useState(false)
  const [excludeErr, setExcludeErr] = useState(null)
  const [savingExclude, setSavingExclude] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const [stopOnError, setStopOnError] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [startErr, setStartErr] = useState(null)
  const [showTerminal, setShowTerminal] = useState(true)

  const { output, state: jobState, sendInput, progress } = useJobStream(jobId, null)

  useEffect(() => {
    getLXCUpdateExcludes()
      .then(d => setExcluded(Array.isArray(d?.excluded) ? d.excluded : []))
      .catch(() => {})
  }, [])

  const sortedLxcs = useMemo(
    () => [...lxcs].sort((a, b) => a.vmid - b.vmid),
    [lxcs],
  )

  const excludeSet = useMemo(() => new Set(excluded), [excluded])

  const counts = useMemo(() => {
    let eligible = 0
    let excludedCount = 0
    let stoppedCount = 0
    for (const ct of sortedLxcs) {
      if (excludeSet.has(ct.vmid)) excludedCount++
      else if (ct.status !== 'running') stoppedCount++
      else eligible++
    }
    return { eligible, excludedCount, stoppedCount }
  }, [sortedLxcs, excludeSet])

  const busy = jobState === 'running'

  const stats = useMemo(() => {
    let queued = 0, running = 0, succeeded = 0, failed = 0, skipped = 0
    for (const p of progress) {
      if (p.status === 'queued') queued++
      else if (p.status === 'running') running++
      else if (p.status === 'succeeded') succeeded++
      else if (p.status === 'failed') failed++
      else if (p.status === 'skipped') skipped++
    }
    const activeTotal = queued + running + succeeded + failed
    const completed = succeeded + failed
    return { queued, running, succeeded, failed, skipped, activeTotal, completed }
  }, [progress])

  async function toggleExclude(vmid) {
    setExcludeErr(null)
    const prev = excluded
    const next = excludeSet.has(vmid)
      ? excluded.filter(id => id !== vmid)
      : [...excluded, vmid].sort((a, b) => a - b)

    setExcluded(next)
    setSavingExclude(true)
    try {
      const res = await putLXCUpdateExcludes(next)
      if (Array.isArray(res?.excluded)) setExcluded(res.excluded)
    } catch (e) {
      setExcluded(prev)
      setExcludeErr(e.message || 'Failed to save exclude list')
    } finally {
      setSavingExclude(false)
    }
  }

  async function handleStart() {
    setConfirming(false)
    setStartErr(null)
    setShowTerminal(true)
    try {
      const res = await updateAllContainers({ continue_on_error: !stopOnError })
      setJobId(res.job_id)
    } catch (e) {
      setStartErr(e.message || 'Could not start batch LXC update')
    }
  }

  const subtitleParts = [`${counts.eligible} eligible`]
  if (counts.excludedCount > 0) subtitleParts.push(`${counts.excludedCount} excluded`)
  if (counts.stoppedCount > 0) subtitleParts.push(`${counts.stoppedCount} stopped`)

  const pct = stats.activeTotal > 0 ? Math.round((stats.completed / stats.activeTotal) * 100) : 0

  return (
    <Card
      className="overflow-hidden"
      icon={<IconContainers />}
      title="LXC Container Updates"
      subtitle={`Batch package upgrades · ${subtitleParts.join(' · ')}`}
      action={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExcludesOpen(v => !v)}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors"
          >
            {excludesOpen ? 'Hide excludes' : `Excludes${counts.excludedCount > 0 ? ` (${counts.excludedCount})` : ''}`}
          </button>

          {!busy && !confirming && (
            <button
              onClick={() => { setStartErr(null); setConfirming(true) }}
              disabled={counts.eligible === 0}
              className="text-xs px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 transition-colors"
            >
              Update all ({counts.eligible})
            </button>
          )}
          {busy && <StatusPill variant="neutral">Updating {stats.completed}/{stats.activeTotal || counts.eligible}</StatusPill>}
        </div>
      }
    >
      {/* Inline confirmation bar */}
      <Expandable open={confirming && !busy}>
        <div className="px-6 py-4 border-b border-white/[0.06] bg-blue-500/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <p className="text-sm text-gray-200">
              Update <span className="font-semibold text-white">{counts.eligible}</span> running container{counts.eligible !== 1 ? 's' : ''} sequentially?
              {(counts.excludedCount > 0 || counts.stoppedCount > 0) && (
                <span className="text-xs text-gray-500 ml-1.5">
                  ({[
                    counts.excludedCount > 0 ? `${counts.excludedCount} excluded` : null,
                    counts.stoppedCount > 0 ? `${counts.stoppedCount} stopped` : null,
                  ].filter(Boolean).join(', ')} will be skipped)
                </span>
              )}
            </p>
            <label className="inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={stopOnError}
                onChange={e => setStopOnError(e.target.checked)}
                className="accent-blue-500"
              />
              Stop queue if a container fails
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStart}
              className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              Start batch update
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Expandable>

      {/* Exclude list manager */}
      <Expandable open={excludesOpen}>
        <div className="px-6 py-4 border-b border-white/[0.06] bg-white/[0.015]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-400">
              Checked containers are skipped during batch updates (you can still update them individually).
            </p>
            {savingExclude && <span className="text-[11px] text-gray-500">Saving…</span>}
          </div>
          {excludeErr && <p className="text-xs text-red-400 mb-2">{excludeErr}</p>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sortedLxcs.map(ct => {
              const isExcluded = excludeSet.has(ct.vmid)
              const running = ct.status === 'running'
              return (
                <label
                  key={ct.vmid}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer select-none transition-colors ${
                    isExcluded
                      ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                      : 'bg-[#0c0c14] border-white/[0.06] text-gray-300 hover:border-white/15'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={isExcluded}
                      disabled={busy}
                      onChange={() => toggleExclude(ct.vmid)}
                      className="accent-amber-500 shrink-0"
                    />
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                    <span className="font-mono text-gray-500 shrink-0">{ct.vmid}</span>
                    <span className="truncate">{ct.name || `CT ${ct.vmid}`}</span>
                  </span>
                  {isExcluded && <span className="text-[10px] uppercase tracking-wider text-amber-400 shrink-0">Skip</span>}
                </label>
              )
            })}
          </div>
        </div>
      </Expandable>

      {startErr && (
        <div className="px-6 py-3 border-b border-white/[0.06]">
          <p className="text-xs text-red-400">{startErr}</p>
        </div>
      )}

      {/* Live queue progress */}
      {progress.length > 0 && (
        <div className="px-6 py-4 border-b border-white/[0.06] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-300 font-medium tabular-nums">
                {stats.completed} / {stats.activeTotal} completed
              </span>
              {stats.succeeded > 0 && <span className="text-emerald-400">{stats.succeeded} succeeded</span>}
              {stats.failed > 0 && <span className="text-red-400">{stats.failed} failed</span>}
              {stats.skipped > 0 && <span className="text-gray-500">{stats.skipped} skipped</span>}
            </div>
            {jobState === 'succeeded' && <StatusPill variant="success">All updated</StatusPill>}
            {jobState === 'failed' && <StatusPill variant="error">Completed with errors</StatusPill>}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${stats.failed > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Per-container rows */}
          <div className="border border-white/[0.06] rounded-xl divide-y divide-white/[0.04] overflow-hidden">
            {progress.map(item => (
              <div
                key={item.vmid}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                  item.status === 'running' ? 'bg-blue-500/[0.07]' : ''
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-mono text-gray-500 tabular-nums w-10 shrink-0">
                    {item.vmid}
                  </span>
                  <span className={`truncate ${item.status === 'skipped' ? 'text-gray-500' : 'text-gray-200'}`}>
                    {item.name || `CT ${item.vmid}`}
                  </span>
                </div>
                <div className="shrink-0">
                  <RowBadge item={item} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live terminal log */}
      {output.length > 0 && (
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setShowTerminal(v => !v)}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              {showTerminal ? 'Hide live log' : 'Show live log'}
            </button>
          </div>
          {showTerminal && <Terminal output={output} state={jobState} sendInput={sendInput} />}
        </div>
      )}

      {/* Idle empty prompt when no run has started yet and exclude drawer is closed */}
      {progress.length === 0 && !excludesOpen && !confirming && !startErr && (
        <div className="px-6 py-5 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {counts.eligible > 0
              ? `Ready to update ${counts.eligible} running container${counts.eligible !== 1 ? 's' : ''} (apt / apk / dnf).`
              : 'No running, non-excluded LXC containers to update.'}
          </span>
          {counts.excludedCount > 0 && (
            <span className="text-amber-400/80">
              Skipping CT {excluded.join(', ')}
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
