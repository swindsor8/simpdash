import { useState, useEffect, useMemo } from 'react'
import { getBackups, getPBS } from '../lib/api'
import { StatusPill } from './Card'
import { loadingText } from '../lib/copy'

function fmtAge(unix) {
  if (!unix) return null
  const s = Date.now() / 1000 - unix
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function fmtBytes(n) {
  if (!n) return ''
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`
}

function fmtDur(start, end) {
  if (!start || !end || end < start) return ''
  const s = end - start
  return s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`
}

// jobState classifies a vzdump task's status field.
export function jobState(status) {
  if (status === 'OK') return 'ok'
  if (!status || status === 'running') return 'running'
  return 'failed'
}

// BackupBadge — per-guest last-backup indicator, reused on the dashboard. It is
// truthful to what storage content can tell us: a backup file's age, or its
// absence. Per-job pass/fail lives in the jobs list below, because PVE reports
// backup success per job, not per guest.
export function BackupBadge({ backup }) {
  if (!backup) return <span className="text-xs text-gray-700">—</span>
  if (!backup.last_backup) return <StatusPill variant="warning">no backup</StatusPill>
  return <StatusPill variant="success" title={fmtBytes(backup.size)}>✓ {fmtAge(backup.last_backup)}</StatusPill>
}

function Degraded({ msg }) {
  return (
    <div className="bg-[#13131e] border border-amber-500/20 rounded-2xl p-10 text-center">
      <p className="text-sm text-gray-300 font-medium">Couldn't load backups</p>
      <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">{msg}</p>
    </div>
  )
}

// PBSSection — datastore usage + per-guest verification from a configured
// Proxmox Backup Server. Renders nothing when the integration is off.
function PBSSection() {
  const [pbs, setPbs] = useState(undefined) // undefined=loading, null=not configured
  const [pbsErr, setPbsErr] = useState(null)

  useEffect(() => {
    let live = true
    getPBS()
      .then(d => { if (live) setPbs(d) })
      .catch(e => { if (live) { setPbs(null); setPbsErr(e.message) } })
    return () => { live = false }
  }, [])

  if (pbs === undefined || (pbs === null && !pbsErr)) return null

  const fmtGB = (n) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : `${(n / 1e9).toFixed(0)} GB`)
  const guests = [...(pbs?.guests ?? [])].sort((a, b) => Number(a.id) - Number(b.id))

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wider text-gray-600 mb-2 px-1">Proxmox Backup Server</h2>
      {pbsErr ? (
        <div className="bg-[#13131e] border border-amber-500/20 rounded-2xl p-5">
          <p className="text-sm text-gray-400">Couldn't reach PBS: <span className="text-amber-400">{pbsErr}</span></p>
        </div>
      ) : (
        <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-5 space-y-4">
          <div className="space-y-2">
            {pbs.datastores.map(ds => {
              const pct = ds.total > 0 ? (ds.used / ds.total) * 100 : 0
              return (
                <div key={ds.store} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-400 w-28 truncate shrink-0">{ds.store}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-400/80' : pct >= 75 ? 'bg-amber-400/80' : 'bg-blue-400/60'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <span className="text-xs font-mono text-gray-600 w-32 text-right shrink-0">
                    {fmtGB(ds.used)} / {fmtGB(ds.total)}
                  </span>
                </div>
              )
            })}
          </div>
          {guests.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-600">
                  {['Guest', 'Datastore', 'Last backup', 'Snapshots', 'Verified'].map(h => (
                    <th key={h} className="text-left font-medium py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guests.map(g => (
                  <tr key={`${g.store}/${g.type}/${g.id}`} className="border-t border-white/[0.05]">
                    <td className="py-2.5 text-gray-300 font-mono text-xs">{g.type === 'vm' ? 'VM' : 'CT'}{g.id}</td>
                    <td className="py-2.5 text-gray-500 text-xs">{g.store}</td>
                    <td className="py-2.5 text-gray-400 text-xs">{fmtAge(g.last_backup) ?? '—'}</td>
                    <td className="py-2.5 text-gray-600 text-xs">{g.count}</td>
                    <td className="py-2.5">
                      {g.verified === 'ok' ? <StatusPill variant="success">verified</StatusPill>
                        : g.verified === 'failed' ? <StatusPill variant="error">verify failed</StatusPill>
                        : <StatusPill variant="neutral">not verified</StatusPill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}

export default function Backups() {
  const loadingMsg = useMemo(() => loadingText('Loading backups…'), [])
  const [data, setData] = useState(null) // null = loading
  const [err, setErr] = useState(null)

  useEffect(() => {
    let live = true
    getBackups()
      .then(d => { if (live) setData(d) })
      .catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [])

  if (err) return <div className="p-8"><Degraded msg={err} /></div>
  if (!data) return <div className="p-8 text-sm text-gray-600">{loadingMsg}</div>

  // Most concerning first: never-backed-up, then oldest backups.
  const guests = [...data.guests].sort((a, b) => (a.last_backup || 0) - (b.last_backup || 0))
  const failed = data.jobs.filter(j => jobState(j.status) === 'failed').length
  const noBackup = guests.filter(g => !g.last_backup).length

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl">
      {(failed > 0 || noBackup > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-300">
          {failed > 0 && <span>{failed} backup job{failed !== 1 ? 's' : ''} failed recently. </span>}
          {noBackup > 0 && <span>{noBackup} guest{noBackup !== 1 ? 's have' : ' has'} no backup.</span>}
        </div>
      )}

      <section className="bg-[#13131e] border border-white/[0.07] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-600">
              {['Guest', 'Node', 'Last backup', 'Size', 'Status'].map(h => (
                <th key={h} className="text-left font-medium px-5 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {guests.map(g => (
              <tr key={g.vmid} className="border-t border-white/[0.05]">
                <td className="px-5 py-3 text-gray-200">
                  {g.name}{' '}
                  <span className="text-xs text-gray-600 font-mono">{g.type === 'qemu' ? 'VM' : 'CT'}{g.vmid}</span>
                </td>
                <td className="px-5 py-3 text-gray-500">{g.node}</td>
                <td className="px-5 py-3 text-gray-400">
                  {g.last_backup ? fmtAge(g.last_backup) : <span className="text-amber-400">never</span>}
                </td>
                <td className="px-5 py-3 text-gray-600">{fmtBytes(g.size) || '—'}</td>
                <td className="px-5 py-3"><BackupBadge backup={g} /></td>
              </tr>
            ))}
            {guests.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-600">No guests found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-600 mb-2 px-1">Recent backup jobs</h2>
        <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl overflow-hidden">
          {data.jobs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-600">No backup jobs recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {data.jobs.slice(0, 20).map(j => {
                  const st = jobState(j.status)
                  return (
                    <tr key={j.upid} className="border-t border-white/[0.05] first:border-t-0">
                      <td className="px-5 py-3">
                        <StatusPill variant={st === 'ok' ? 'success' : st === 'failed' ? 'error' : 'neutral'}>
                          {st === 'ok' ? 'OK' : st === 'failed' ? 'failed' : 'running'}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-3 text-gray-500">{j.node}</td>
                      <td className="px-5 py-3 text-gray-400">{fmtAge(j.starttime)}</td>
                      <td className="px-5 py-3 text-gray-600">{fmtDur(j.starttime, j.endtime)}</td>
                      <td className="px-5 py-3 text-gray-700 text-xs font-mono truncate max-w-xs" title={j.status}>
                        {st === 'failed' ? j.status : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <PBSSection />
    </div>
  )
}
