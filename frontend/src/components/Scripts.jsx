import { useState, useEffect } from 'react'
import { getCatalog, runScript } from '../lib/api'
import { useJobStream } from '../hooks/useJobStream'
import Terminal from './Terminal'

// A warning is "creating" infrastructure (a new LXC/VM) — surfaced loudest in
// the confirm dialog since it changes the host, not just an app.
function isCreateWarning(w) {
  return /creates a new/i.test(w)
}

function IconWarn() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

function WarningPill({ text }) {
  const create = isCreateWarning(text)
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${
      create ? 'bg-amber-500/15 text-amber-400' : 'bg-white/8 text-gray-400'
    }`}>
      {create && <IconWarn />}
      {text}
    </span>
  )
}

function fmtRam(mb) {
  return mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`
}

function TypeBadge({ type }) {
  const styles = {
    vm:  'bg-purple-500/15 text-purple-300',
    pve: 'bg-orange-500/15 text-orange-300',
  }
  const labels = { vm: 'VM', pve: 'PVE' }
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
      styles[type] ?? 'bg-blue-500/15 text-blue-300'
    }`}>
      {labels[type] ?? 'LXC'}
    </span>
  )
}

function ScriptCard({ script, disabled, onRun }) {
  const res = script.resources
  return (
    <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-5 flex flex-col">
      <div className="flex items-start justify-between mb-2 gap-3">
        <h3 className="text-sm font-semibold text-white">{script.name}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          {script.type && <TypeBadge type={script.type} />}
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-gray-400 font-medium">
            {script.category}
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed mb-2 flex-1">{script.description}</p>
      {res && (res.cpu || res.ram_mb || res.disk_gb) && (
        <p className="text-[11px] text-gray-700 mb-3 font-mono">
          {res.cpu} CPU · {fmtRam(res.ram_mb)} RAM · {res.disk_gb} GB disk
        </p>
      )}
      {script.warnings?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {script.warnings.map(w => <WarningPill key={w} text={w} />)}
        </div>
      )}
      <button
        onClick={() => onRun(script)}
        disabled={disabled}
        className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-start"
      >
        {script.type === 'pve' ? 'Run' : 'Install'}
      </button>
    </div>
  )
}

// ConfirmDialog is a custom modal (deliberately NOT window.confirm) so the
// "creates a new LXC/VM, runs as root" warning is impossible to miss before a
// host-modifying script runs. Dismissible via Cancel, backdrop, or Escape.
function ConfirmDialog({ script, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const creates = script.warnings?.filter(isCreateWarning) ?? []
  const others = script.warnings?.filter(w => !isCreateWarning(w)) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-white mb-1">{script.type === 'pve' ? 'Run' : 'Install'} {script.name}?</h2>
        <p className="text-xs text-gray-500 mb-4">{script.description}</p>

        {creates.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 mb-3">
            <span className="text-amber-400 mt-0.5"><IconWarn /></span>
            <div className="text-xs text-amber-300">
              {creates.map(w => <div key={w} className="font-medium">{w}</div>)}
              <p className="text-amber-400/70 mt-1">This runs as root and modifies the Proxmox host.</p>
            </div>
          </div>
        )}
        {others.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {others.map(w => <WarningPill key={w} text={w} />)}
          </div>
        )}

        {script.resources && (script.resources.cpu || script.resources.ram_mb) && (
          <p className="text-[11px] text-gray-600 font-mono mb-3">
            Allocates: {script.resources.cpu} CPU · {fmtRam(script.resources.ram_mb)} RAM · {script.resources.disk_gb} GB disk
          </p>
        )}
        <p className="text-[11px] text-gray-600 font-mono break-all mb-5">{script.script_url}</p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            {script.type === 'pve' ? 'Yes, run' : 'Yes, install'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Group scripts by category, preserving the manifest's first-seen order.
function groupByCategory(scripts) {
  const groups = new Map()
  for (const s of scripts) {
    const cat = s.category || 'Other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat).push(s)
  }
  return [...groups]
}

function IconChevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0 transition-transform group-open:rotate-90">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function Scripts({ node = null }) {
  const [scripts, setScripts] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [pending, setPending] = useState(null)   // script awaiting confirm
  const [running, setRunning] = useState(null)   // name of the running script
  const [jobId, setJobId] = useState(null)
  const [startErr, setStartErr] = useState(null)
  const { output, state: jobState, sendInput } = useJobStream(jobId, node)
  const busy = jobState === 'running'

  useEffect(() => {
    setScripts(null)
    setLoadErr(null)
    getCatalog(node).then(setScripts).catch(e => setLoadErr(e.message))
  }, [node])

  async function confirmRun() {
    const script = pending
    setPending(null)
    setStartErr(null)
    try {
      const data = await runScript(node, script.id)
      setRunning(script.name)
      setJobId(data.job_id)
    } catch (e) {
      // 409 = a job is already running; surface it rather than silently failing.
      setStartErr(e.message)
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      {loadErr && <p className="text-sm text-red-400">Failed to load catalog: {loadErr}</p>}
      {scripts === null && !loadErr && (
        <p className="text-sm text-gray-600">Loading catalog…</p>
      )}

      {scripts && groupByCategory(scripts).map(([cat, items]) => (
        <details key={cat} open className="group">
          <summary className="flex items-center gap-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-white py-2">
            <IconChevron />
            {cat}
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-gray-400 font-medium">
              {items.length}
            </span>
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-3">
            {items.map(s => (
              <ScriptCard key={s.id} script={s} disabled={busy} onRun={setPending} />
            ))}
          </div>
        </details>
      ))}

      {(running || startErr) && (
        <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6 space-y-2">
          {running && (
            <p className="text-sm text-gray-400">
              {busy ? 'Installing' : 'Last install:'}{' '}
              <span className="text-white font-medium">{running}</span>
            </p>
          )}
          {startErr && <p className="text-xs text-red-400">{startErr}</p>}
          <Terminal output={output} state={jobState} sendInput={sendInput} />
        </div>
      )}

      {pending && (
        <ConfirmDialog
          script={pending}
          onCancel={() => setPending(null)}
          onConfirm={confirmRun}
        />
      )}
    </main>
  )
}
