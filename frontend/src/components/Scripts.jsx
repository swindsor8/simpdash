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

// TerminalDialog floats the live install output in a modal so it doesn't push
// the catalog down. Stays open while running (interactive whiptail menus need
// the keystroke stream); closeable any time via the X, backdrop, or Escape —
// the job keeps running on the server if dismissed mid-install.
function TerminalDialog({ running, busy, startErr, output, jobState, sendInput, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#13131e] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-2"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          {running && (
            <p className="text-sm text-gray-400">
              {busy ? 'Installing' : 'Last install:'}{' '}
              <span className="text-white font-medium">{running}</span>
            </p>
          )}
          <button
            onClick={onClose}
            className="ml-auto text-xs px-3 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors"
          >
            Close
          </button>
        </div>
        {startErr && <p className="text-xs text-red-400">{startErr}</p>}
        <Terminal output={output} state={jobState} sendInput={sendInput} />
      </div>
    </div>
  )
}

// Category taxonomy mirrors community-scripts.org: name → lucide-style icon
// path, listed in the site's sort order. Categories not in this map sort to the
// end alphabetically with a default icon, so a new manifest category still shows
// up without a code change here.
const CATEGORY_ORDER = [
  'Proxmox & Virtualization', 'Operating Systems', 'Containers & Docker',
  'Network & Firewall', 'Adblock & DNS', 'Authentication & Security',
  'Backup & Recovery', 'Databases', 'Monitoring & Analytics',
  'Dashboards & Frontends', 'Files & Downloads', 'Documents & Notes',
  'Media & Streaming', 'IoT & Smart Home', 'Automation & Scheduling',
  'Webservers & Proxies', 'Miscellaneous',
]

// Minimal inline icons (the app draws its own SVGs rather than pull in a lib).
const CATEGORY_ICONS = {
  'Proxmox & Virtualization': <><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></>,
  'Operating Systems': <><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></>,
  'Containers & Docker': <><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></>,
  'Adblock & DNS': <><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>,
  'Monitoring & Analytics': <><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></>,
  'Media & Streaming': <polygon points="6 3 20 12 6 21 6 3"/>,
  'IoT & Smart Home': <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
  'Webservers & Proxies': <><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></>,
}
const DEFAULT_ICON = <><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>

function CatIcon({ category }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {CATEGORY_ICONS[category] ?? DEFAULT_ICON}
    </svg>
  )
}

// Distinct categories present in `scripts`, in the site's sort order (unknown
// categories appended alphabetically), each with its script count.
function categoriesOf(scripts) {
  const counts = new Map()
  for (const s of scripts) {
    const cat = s.category || 'Miscellaneous'
    counts.set(cat, (counts.get(cat) || 0) + 1)
  }
  const rank = (c) => {
    const i = CATEGORY_ORDER.indexOf(c)
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  return [...counts.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(name => ({ name, count: counts.get(name) }))
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
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
  const [showTerm, setShowTerm] = useState(false)
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState(null) // null = All
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
      setShowTerm(true)
    } catch (e) {
      // 409 = a job is already running; surface it rather than silently failing.
      setStartErr(e.message)
    }
  }

  // Search filters the whole catalog by name/description; the sidebar then
  // reflects only categories with matches, and the card grid shows the active
  // category (or everything, when "All" is selected).
  const q = query.trim().toLowerCase()
  const filtered = (scripts ?? []).filter(s =>
    !q || s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
  )
  const cats = categoriesOf(filtered)
  // Keep the selection valid as search narrows the available categories.
  const selected = cats.some(c => c.name === activeCat) ? activeCat : null
  const shown = selected ? filtered.filter(s => s.category === selected) : filtered

  return (
    <div className="flex flex-1 min-h-0">
      {/* In-tab category sidebar */}
      <aside className="w-60 shrink-0 border-r border-white/[0.06] flex flex-col p-3 overflow-y-auto">
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><IconSearch /></span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search scripts…"
            className="w-full bg-white/5 border border-white/[0.07] rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
          />
        </div>
        <button
          onClick={() => setActiveCat(null)}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
            selected === null ? 'bg-white/10 text-white font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
          }`}
        >
          <CatIcon category="__all" />
          <span className="flex-1 text-left">All scripts</span>
          <span className="text-[11px] text-gray-500">{filtered.length}</span>
        </button>
        <div className="space-y-0.5 mt-0.5">
          {cats.map(c => (
            <button
              key={c.name}
              onClick={() => setActiveCat(c.name)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
                selected === c.name ? 'bg-white/10 text-white font-medium' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <CatIcon category={c.name} />
              <span className="flex-1 text-left truncate">{c.name}</span>
              <span className="text-[11px] text-gray-500">{c.count}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Card pane — uses the full remaining width */}
      <main className="flex-1 p-8 space-y-4 overflow-y-auto">
        {loadErr && <p className="text-sm text-red-400">Failed to load catalog: {loadErr}</p>}
        {scripts === null && !loadErr && (
          <p className="text-sm text-gray-600">Loading catalog…</p>
        )}
        {scripts && shown.length === 0 && (
          <p className="text-sm text-gray-600">No scripts match “{query}”.</p>
        )}

        {scripts && shown.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              {selected && <CatIcon category={selected} />}
              {selected ?? 'All scripts'}
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-gray-400 font-medium">
                {shown.length}
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {shown.map(s => (
                <ScriptCard key={s.id} script={s} disabled={busy} onRun={setPending} />
              ))}
            </div>
          </>
        )}
      </main>

      {(showTerm || startErr) && (
        <TerminalDialog
          running={running}
          busy={busy}
          startErr={startErr}
          output={output}
          jobState={jobState}
          sendInput={sendInput}
          onClose={() => { setShowTerm(false); setStartErr(null) }}
        />
      )}

      {pending && (
        <ConfirmDialog
          script={pending}
          onCancel={() => setPending(null)}
          onConfirm={confirmRun}
        />
      )}
    </div>
  )
}
