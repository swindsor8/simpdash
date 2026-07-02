import { useState, useEffect, useMemo } from 'react'
import { getJobs, getClusterTasks } from '../lib/api'
import { useJobStream } from '../hooks/useJobStream'
import { useFocusTrap } from '../lib/a11y'
import Terminal from './Terminal'
import { StatusPill } from './Card'
import { loadingText } from '../lib/copy'

function fmtAgo(ts) {
  if (!ts) return '—'
  const s = Date.now() / 1000 - ts
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

const JOB_LABELS = {
  apt_upgrade: 'System upgrade',
  ct_upgrade: 'Container upgrade',
  script: 'Script install',
}

// Friendly names for the noisiest PVE task types; unknown types show raw.
const TASK_LABELS = {
  vzdump: 'Backup', qmstart: 'VM start', qmstop: 'VM stop', qmshutdown: 'VM shutdown',
  qmreboot: 'VM reboot', vzstart: 'CT start', vzstop: 'CT stop', vzshutdown: 'CT shutdown',
  vzreboot: 'CT reboot', qmigrate: 'Migration', vzmigrate: 'Migration',
  startall: 'Start all', stopall: 'Stop all', srvreload: 'Service reload',
  aptupdate: 'APT update', imgcopy: 'Image copy', qmsnapshot: 'Snapshot', vzsnapshot: 'Snapshot',
}

function taskVariant(status) {
  if (status === '') return 'neutral' // still running
  if (status === 'OK') return 'success'
  if (/^WARNINGS/.test(status)) return 'warning'
  return 'error'
}

// LogModal replays a finished job's stored output (or streams a running one).
function LogModal({ job, onClose }) {
  const { output, state } = useJobStream(job.id, null)
  const trap = useFocusTrap()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={trap} role="dialog" aria-modal="true" aria-label="Job log"
        className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-white truncate">
            {JOB_LABELS[job.type] ?? job.type} · {fmtAgo(new Date(job.started_at).getTime() / 1000)}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-sm">✕</button>
        </div>
        <Terminal output={output} state={state} />
      </div>
    </div>
  )
}

export default function Activity() {
  const loadingMsg = useMemo(() => loadingText('Loading activity…'), [])
  const [jobs, setJobs] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [openJob, setOpenJob] = useState(null)

  useEffect(() => {
    let live = true
    const load = () => {
      getJobs().then(d => live && setJobs(d)).catch(() => live && setJobs([]))
      getClusterTasks().then(d => live && setTasks(d)).catch(() => live && setTasks([]))
    }
    load()
    const t = setInterval(load, 30000)
    return () => { live = false; clearInterval(t) }
  }, [])

  if (jobs === null && tasks === null) {
    return <div className="p-4 sm:p-8 text-sm text-gray-600">{loadingMsg}</div>
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl">

      {/* SuperDash jobs — updates and script installs run by this dashboard */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-600 mb-2 px-1">SuperDash jobs</h2>
        <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl overflow-hidden">
          {(jobs ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-600">
              No jobs yet — updates and script installs will appear here.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(jobs ?? []).slice(0, 30).map(j => (
                  <tr key={j.id} className="border-t border-white/[0.05] first:border-t-0 hover:bg-white/5">
                    <td className="px-5 py-3">
                      <StatusPill variant={j.status === 'succeeded' ? 'success' : j.status === 'running' ? 'neutral' : 'error'}>
                        {j.status}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{JOB_LABELS[j.type] ?? j.type}</td>
                    <td className="px-5 py-3 text-gray-500">{fmtAgo(new Date(j.started_at).getTime() / 1000)}</td>
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {j.exit_code !== undefined && j.exit_code !== null && j.exit_code !== 0 ? `exit ${j.exit_code}` : ''}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setOpenJob(j)}
                        className="text-xs px-3 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors"
                      >
                        View log
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Cluster task log — everything Proxmox did recently, dashboard or not */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-gray-600 mb-2 px-1">Proxmox cluster tasks</h2>
        <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl overflow-hidden">
          {(tasks ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-600">No recent cluster tasks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {(tasks ?? []).map(t => (
                    <tr key={t.upid} className="border-t border-white/[0.05] first:border-t-0 hover:bg-white/5">
                      <td className="px-5 py-2.5">
                        <StatusPill variant={taskVariant(t.status)}>
                          {t.status === '' ? 'running' : t.status === 'OK' ? 'OK' : /^WARNINGS/.test(t.status) ? 'warnings' : 'failed'}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-2.5 text-gray-300 whitespace-nowrap">{TASK_LABELS[t.type] ?? t.type}</td>
                      <td className="px-5 py-2.5 text-gray-500 font-mono text-xs">{t.id || ''}</td>
                      <td className="px-5 py-2.5 text-gray-500">{t.node}</td>
                      <td className="px-5 py-2.5 text-gray-600 text-xs whitespace-nowrap">{fmtAgo(t.starttime)}</td>
                      <td className="px-5 py-2.5 text-gray-700 text-xs font-mono truncate max-w-[16rem]" title={t.status}>
                        {t.status && t.status !== 'OK' ? t.status : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {openJob && <LogModal job={openJob} onClose={() => setOpenJob(null)} />}
    </div>
  )
}
