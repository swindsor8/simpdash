import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  logout, getNodes, getBackups, getNoteCounts, getInfo, entityAction, updateContainer,
  getServiceLinks, upsertServiceLink, deleteServiceLink, serviceIconUrl,
  getServiceHealth, getGuestIPs, getUpdatesPending, getRRD,
  getGuestServices, getGuestDocker,
} from '../lib/api'
import logo from '../../assets/logo.png'
import { useResourceStream } from '../hooks/useResourceStream'
import { useJobStream } from '../hooks/useJobStream'
import Terminal from './Terminal'
import Updates from './Updates'
import Scripts from './Scripts'
import Nodes from './Nodes'
import Network from './Network'
import Backups, { BackupBadge } from './Backups'
import Notebook from './Notebook'
import Activity from './Activity'
import Settings from './Settings'
import ErrorBoundary from './ErrorBoundary'
import UpdateBanner from './UpdateBanner'
import { Card, StatCard, StatusPill, statusVariant } from './Card'
import RadialGauge from './RadialGauge'
import { usePowerMorph, useStatusGlow } from './motion'
import { copy } from '../lib/copy'
import { cardA11y, useFocusTrap } from '../lib/a11y'

// --- helpers ---
// fmtPair — "8.8 / 34 GB": used/total in a single unit, for a gauge's caption.
function fmtPair(a, b) {
  const gb = b >= 1e9
  const div = gb ? 1e9 : 1e6
  const f = (n) => { const v = n / div; return v >= 100 ? Math.round(v) : v.toFixed(1) }
  return `${f(a)} / ${f(b)} ${gb ? 'GB' : 'MB'}`
}
function fmtUptime(s) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h`
}

// consoleUrl deep-links to the PVE web UI's noVNC/xterm console for a guest.
// When the backend talks to PVE via localhost, substitute the host the browser
// used — a 127.0.0.1 link is useless from another machine.
function consoleUrl(pveURL, node, pxType, vmid) {
  let host = ''
  try { host = new URL(pveURL).host } catch { /* fall through */ }
  if (!host || /^(127\.|localhost)/.test(host)) host = `${window.location.hostname}:8006`
  const ct = pxType === 'qemu' ? 'kvm' : 'lxc'
  return `https://${host}/?console=${ct}&novnc=1&vmid=${vmid}&node=${encodeURIComponent(node)}`
}

// MiniSpark — tiny inline sparkline for node trend rows.
function MiniSpark({ data, color = '#60a5fa', width = 72, height = 20 }) {
  if (!data || data.length < 2) return <svg width={width} height={height} aria-hidden="true" />
  const max = Math.max(...data, 0.0001)
  const step = width / (data.length - 1)
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - (Math.max(0, v) / max) * (height - 2) - 1).toFixed(1)}`)
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}

// HealthDot — service reachability from the backend prober.
function HealthDot({ health }) {
  if (!health) return null
  return (
    <span
      title={health.up ? `Service up · HTTP ${health.status} · ${health.latency_ms} ms` : 'Service unreachable'}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${health.up ? 'bg-emerald-400' : 'bg-red-400'}`}
    />
  )
}

// --- icons ---
function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )
}
function IconDownload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  )
}
function IconTerminal() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  )
}
function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}
function IconServer() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  )
}
function IconMonitor() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )
}
function IconBox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  )
}
function IconCpu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  )
}

function IconNetwork() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/>
      <path d="M12 8v4M12 12H5v4M12 12h7v4"/>
    </svg>
  )
}

function IconWifi() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>
    </svg>
  )
}

function IconArchive() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/>
    </svg>
  )
}

function IconNote() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  )
}

function IconNoteSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>
    </svg>
  )
}

function IconGear() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

function IconExternalLink() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
}

function IconUpdateSm() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
      <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
    </svg>
  )
}

// JobModal — streams a running executor job's live output (reuses the Updates/
// Scripts terminal plumbing). Used for per-container apt upgrades.
function JobModal({ jobId, title, onClose }) {
  const { output, state, sendInput } = useJobStream(jobId, null)
  const trap = useFocusTrap()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={trap} role="dialog" aria-modal="true" aria-label={title} className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-white truncate">{title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {state === 'running' && <StatusPill variant="neutral">Running…</StatusPill>}
            {state === 'succeeded' && <StatusPill variant="success">Done</StatusPill>}
            {state === 'failed' && <StatusPill variant="error">Failed</StatusPill>}
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-sm">✕</button>
          </div>
        </div>
        <Terminal output={output} state={state} sendInput={sendInput} />
      </div>
    </div>
  )
}

// ConfirmModal — generic danger confirmation, reuses the Scripts.jsx pattern.
function ConfirmModal({ confirm, onConfirm, onCancel }) {
  const trap = useFocusTrap()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const { entityType, entityId, action, isSelf, name } = confirm
  const isForceStop = action === 'stop'
  const isUpdate = action === 'update'
  const verb = isUpdate ? 'Update' : action === 'reboot' ? 'Reboot' : action === 'shutdown' ? 'Shut down' : 'Force stop'

  let title, body, danger = isForceStop
  if (isUpdate) {
    title = `Update ${name || `container ${entityId}`}?`
    body = 'Runs apt-get update && apt-get -y upgrade inside the container. It must be running; the upgrade can restart services inside it.'
  } else if (isForceStop) {
    title = `Force stop ${entityId}?`
    body = copy('confirm.forceStop', 'This is the equivalent of pulling the power. The guest will not shut down gracefully and may lose unsaved data or corrupt the filesystem.')
  } else {
    title = `${verb} node ${entityId}?`
    body = copy('confirm.node', `This will ${action} the node and interrupt every VM and container running on it.`)
    if (isSelf) body += ' ' + copy('confirm.selfNode', 'This is the node SuperDash is running on — this dashboard will disconnect until it comes back up.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onCancel}>
      <div ref={trap} role="dialog" aria-modal="true" aria-label={title} className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white mb-3">{title}</h2>
        <p className="text-sm text-gray-400 mb-5">{body}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className={`text-xs px-4 py-2 rounded-lg font-medium transition-colors ${danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            {verb}
          </button>
        </div>
      </div>
    </div>
  )
}

// ServiceLinkEditor — popover for the card's primary link plus optional extra
// links (one guest often hosts several apps, e.g. a docker LXC).
function ServiceLinkEditor({ entityType, entityId, link, onDone, onClose }) {
  const [url, setUrl] = useState(link?.url ?? '')
  const [label, setLabel] = useState(link?.label ?? '')
  const [extras, setExtras] = useState(link?.extras ?? [])
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setExtra = (i, k, v) => setExtras(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  async function save() {
    setSaving(true); setErr(null)
    try {
      const clean = extras.filter(x => x.url)
      await upsertServiceLink(entityType, entityId, url, label || null, clean)
      onDone()
      onClose()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await deleteServiceLink(entityType, entityId)
      onDone()
      onClose()
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div className="absolute top-6 right-0 z-40 bg-[#13131e] border border-white/20 rounded-xl p-3 shadow-2xl w-72" onClick={e => e.stopPropagation()}>
      <p className="text-[11px] text-gray-400 font-medium mb-2">Service link</p>
      <input
        autoFocus
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        placeholder="http://192.168.1.50:8080"
        className="w-full bg-[#0c0c14] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50 mb-1.5"
      />
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        placeholder="Label (optional)"
        className="w-full bg-[#0c0c14] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50 mb-2"
      />
      {extras.length > 0 && <p className="text-[11px] text-gray-500 mb-1">More links</p>}
      {extras.map((x, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input
            value={x.url}
            onChange={e => setExtra(i, 'url', e.target.value)}
            placeholder="http://…"
            className="flex-1 min-w-0 bg-[#0c0c14] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
          />
          <input
            value={x.label}
            onChange={e => setExtra(i, 'label', e.target.value)}
            placeholder="Label"
            className="w-20 bg-[#0c0c14] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
          />
          <button
            onClick={() => setExtras(xs => xs.filter((_, j) => j !== i))}
            title="Remove this link"
            className="text-gray-600 hover:text-red-400 text-xs px-1 transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
      {extras.length < 8 && (
        <button
          onClick={() => setExtras(xs => [...xs, { url: '', label: '' }])}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors mb-2"
        >
          + Add another link
        </button>
      )}
      {err && <p className="text-[11px] text-red-400 mb-1.5">{err}</p>}
      <div className="flex gap-1.5">
        <button onClick={save} disabled={saving || !url} className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40">
          Save
        </button>
        {link && (
          <button onClick={remove} className="text-xs px-2 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
            Remove
          </button>
        )}
        <button onClick={onClose} className="text-xs px-2 py-1.5 rounded-lg border border-white/10 text-gray-500 hover:text-gray-300 transition-colors">
          ✕
        </button>
      </div>
    </div>
  )
}

// --- sub-components ---
function NavItem({ icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
        active
          ? 'bg-white/10 text-white font-medium'
          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium tabular-nums">
          {badge}
        </span>
      )}
    </button>
  )
}

function IconActivity() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  )
}
function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}
function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  )
}

// LocalOnlyNote — shown on tabs that always read the LOCAL host while a paired
// secondary is selected in the sidebar, so the selector never silently lies.
function LocalOnlyNote({ activeNode }) {
  if (!activeNode) return null
  return (
    <StatusPill variant="warning" title="The node selector doesn't apply here — this tab always shows the local host.">
      local host only
    </StatusPill>
  )
}

// NodeGauge — a labelled large gauge for the node card (metric name above the
// ring, absolute figures folded into the gauge's own centre caption).
function NodeGauge({ name, ...rest }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{name}</span>
      <RadialGauge size="lg" {...rest} />
    </div>
  )
}

// CompactGauge — a small gauge + metric name for a VM/LXC card.
function CompactGauge({ name, ...rest }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <RadialGauge size="sm" {...rest} />
      <span className="text-[9px] uppercase tracking-wider text-gray-500">{name}</span>
    </div>
  )
}

// StatusDot — emerald + slow breathing pulse while live, one-shot ring ping on
// each fresh frame; switches to a static amber dot once disconnected (debounced).
function StatusDot({ pulseKey, connected, disconnected }) {
  const live = !disconnected
  return (
    <span className="relative inline-flex h-2 w-2">
      {connected && live && (
        <span key={pulseKey} className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping-once" />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${live ? 'bg-emerald-400 animate-breathe' : 'bg-amber-400'}`} />
    </span>
  )
}

function IconEye() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  )
}
function IconWarnSm() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

// MonitorOnlyBadge marks a cluster node SimpDash can see but has no agent on —
// amber "partial state" language, deliberately distinct from the emerald
// "online/running" status so it reads as a heads-up, not a healthy node.
function MonitorOnlyBadge() {
  return (
    <StatusPill variant="warning"><IconEye /> {copy('badge.monitor', 'Monitor only')}</StatusPill>
  )
}

// DegradedNotice is the single "something's down / partial" panel used for both
// Proxmox-unavailable and node-unreachable, so every degraded state looks the
// same across the app (consistent with the M2 degraded pattern).
function DegradedNotice({ title, detail }) {
  return (
    <div className="bg-[#13131e] border border-amber-500/20 rounded-2xl p-10 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 mb-3">
        <IconWarnSm />
      </div>
      <p className="text-sm text-gray-300 font-medium">{title}</p>
      <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">{detail}</p>
    </div>
  )
}

// StorageBar — one storage pool's usage row on the node card.
function StorageBar({ pool }) {
  const pct = pool.maxdisk > 0 ? (pool.disk / pool.maxdisk) * 100 : 0
  const hot = pct >= 90
  const warm = pct >= 75
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] font-mono text-gray-500 truncate w-24 shrink-0" title={pool.id}>
        {pool.id}{pool.shared ? ' ·s' : ''}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden min-w-[3rem]">
        <div
          className={`h-full rounded-full ${hot ? 'bg-red-400/80' : warm ? 'bg-amber-400/80' : 'bg-blue-400/60'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={`text-[11px] font-mono w-24 text-right shrink-0 ${hot ? 'text-red-400' : warm ? 'text-amber-400' : 'text-gray-600'}`}>
        {pool.status !== 'available' ? pool.status : fmtPair(pool.disk, pool.maxdisk)}
      </span>
    </div>
  )
}

// NodeTrends — 1h CPU/memory sparklines from PVE's own RRD store. Local
// cluster only (the endpoint queries the local PVE API); silently absent for
// paired-node views and monitor-only nodes that error out.
function NodeTrends({ nodeId, online }) {
  const [pts, setPts] = useState(null)
  useEffect(() => {
    if (!online) return
    let live = true
    const load = () => getRRD(nodeId, 'hour').then(d => live && setPts(d)).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => { live = false; clearInterval(t) }
  }, [nodeId, online])
  if (!pts || pts.length < 2) return null
  const cpu = pts.map(p => p.cpu ?? 0)
  const mem = pts.map(p => (p.memtotal ? (p.memused ?? 0) / p.memtotal : 0))
  return (
    <div className="flex items-center gap-4 mt-3" title="Last hour (from Proxmox RRD)">
      <span className="text-[10px] uppercase tracking-wider text-gray-600">1h</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-600">cpu</span>
        <MiniSpark data={cpu} color="#60a5fa" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-600">mem</span>
        <MiniSpark data={mem} color="#34d399" />
      </div>
    </div>
  )
}

function NodeCard({ node, selfNode, serviceLinks, onServiceLinkChange, inflight, onAction, onInstallAgent, localCluster }) {
  const monitorOnly = node.managed === false
  const online = node.status === 'online'
  const link = serviceLinks[`node:${node.id}`]
  const isInflight = !!inflight[`node:${node.id}`]
  const justDone = usePowerMorph(isInflight)
  const glow = useStatusGlow(node.status)
  const [showEditor, setShowEditor] = useState(false)
  const [showStorage, setShowStorage] = useState(false)

  function handleCardClick() {
    if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
  }

  const storage = node.storage ?? []
  const worstStorage = storage.reduce((m, p) => Math.max(m, p.maxdisk > 0 ? p.disk / p.maxdisk : 0), 0)

  return (
    <Card
      className={`p-6 relative card-lift hover:border-white/20 ${glow || ''} ${link ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      {...cardA11y(link ? handleCardClick : null, `Open ${link?.label || node.id}`)}
    >
      {/* Gear + external-link indicators — always visible, never hover-only */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        {link && <span className="ext-cue text-gray-600 opacity-50"><IconExternalLink /></span>}
        <div className="relative">
          <button
            onClick={() => setShowEditor(v => !v)}
            className="gear-btn text-gray-600 hover:text-gray-400 transition-colors"
            title="Edit service link"
          >
            <IconGear />
          </button>
          {showEditor && (
            <ServiceLinkEditor
              entityType="node" entityId={node.id} link={link}
              onDone={onServiceLinkChange} onClose={() => setShowEditor(false)}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Identity + status + power controls */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-5 gap-2 pr-12">
            <div>
              <h2 className="text-sm font-semibold text-white">{node.id}</h2>
              <p className="text-xs text-gray-600 mt-0.5">up {fmtUptime(node.uptime)}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {monitorOnly && <MonitorOnlyBadge />}
              <StatusPill variant={statusVariant(node.status)}>{node.status}</StatusPill>
            </div>
          </div>

          {/* Node power controls */}
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {!online && (
              <button
                disabled={isInflight}
                onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'wake' })}
                title="Send a wake-on-LAN packet via the cluster (needs the WOL MAC set in this node's PVE options)"
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
              >
                Wake
              </button>
            )}
            <button
              disabled={isInflight || !online}
              onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'reboot', isSelf: node.id === selfNode })}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
            >
              Reboot
            </button>
            <button
              disabled={isInflight || !online}
              onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'shutdown', isSelf: node.id === selfNode })}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
            >
              Shutdown
            </button>
            {isInflight ? (
              <svg className="animate-spin text-gray-500 ml-1" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : justDone ? (
              <span className="ml-1 text-emerald-400 animate-fade-in" title="Done">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            ) : null}
            {monitorOnly && (
              <button
                onClick={onInstallAgent}
                className="ml-auto shrink-0 text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                Install agent
              </button>
            )}
          </div>
          {monitorOnly && (
            <p className="text-xs text-gray-600 mt-2">No SuperDash agent here — stats only.</p>
          )}

          {localCluster && <NodeTrends nodeId={node.id} online={online} />}
        </div>

        {/* CPU / Memory / Disk gauges — fill the horizontal space freed up at wide widths */}
        <div className="flex items-center justify-center gap-5 sm:gap-7 shrink-0 flex-wrap" onClick={e => e.stopPropagation()}>
          <NodeGauge name="CPU" value={node.cpu} max={1} label={`of ${node.maxcpu} cores`} format={n => `${n.toFixed(1)}%`} />
          <NodeGauge name="Memory" value={node.mem} max={node.maxmem} label={fmtPair(node.mem, node.maxmem)} />
          <NodeGauge name="Disk" value={node.disk} max={node.maxdisk} label={fmtPair(node.disk, node.maxdisk)} />
        </div>
      </div>

      {/* Storage pools — collapsed to a summary line; full stores die quietly,
          so the worst pool's fill level is always visible up front. */}
      {storage.length > 0 && (
        <div className="mt-5 pt-4 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setShowStorage(v => !v)}
            aria-expanded={showStorage}
            className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-600 hover:text-gray-400 transition-colors"
          >
            <span className={`inline-block transition-transform ${showStorage ? 'rotate-90' : ''}`}>▸</span>
            Storage · {storage.length} pool{storage.length !== 1 ? 's' : ''}
            {worstStorage >= 0.9 && <StatusPill variant="error">{Math.round(worstStorage * 100)}% full</StatusPill>}
            {worstStorage >= 0.75 && worstStorage < 0.9 && <StatusPill variant="warning">{Math.round(worstStorage * 100)}% full</StatusPill>}
          </button>
          {showStorage && (
            <div className="mt-3 space-y-2">
              {[...storage].sort((a, b) => (b.maxdisk ? b.disk / b.maxdisk : 0) - (a.maxdisk ? a.disk / a.maxdisk : 0)).map(p => (
                <StorageBar key={p.id} pool={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ServiceIcon shows the linked service's favicon via the backend proxy (works
// under HTTPS where a direct http:// favicon would be blocked as mixed
// content), then tries the selfh.st icon catalog by guest name, then falls
// back to the generic VM/CT glyph.
function ServiceIcon({ entityType, entityId, hasLink, name, fallback }) {
  const sources = useMemo(() => {
    const out = []
    if (hasLink) out.push(serviceIconUrl(entityType, entityId))
    const slug = (name || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (slug) out.push(`https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`)
    return out
  }, [entityType, entityId, hasLink, name])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [sources])
  if (idx >= sources.length) return fallback
  return (
    <img
      src={sources[idx]}
      alt=""
      loading="lazy"
      className="w-6 h-6 rounded object-contain"
      onError={() => setIdx(i => i + 1)}
    />
  )
}

// GuestDetails — lazy-loaded "what's actually running in this box" panel:
// systemd services plus docker containers (when docker exists in the guest).
function GuestDetails({ vmid, etype }) {
  const [services, setServices] = useState(null) // null=loading, {err} on failure
  const [docker, setDocker] = useState(null)

  useEffect(() => {
    let live = true
    getGuestServices(vmid, etype)
      .then(d => live && setServices(d))
      .catch(e => live && setServices({ err: e.message }))
    getGuestDocker(vmid, etype)
      .then(d => live && setDocker(d))
      .catch(() => live && setDocker({ err: true })) // absent docker is normal — stay quiet
    return () => { live = false }
  }, [vmid, etype])

  return (
    <div className="mt-2 pt-2 border-t border-white/[0.06] space-y-2 text-left">
      {docker && !docker.err && docker.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Docker</p>
          <ul className="space-y-0.5">
            {docker.map(c => (
              <li key={c.name} className="flex items-center gap-1.5 text-[11px] text-gray-400 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.state === 'running' ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                <span className="truncate">{c.name}</span>
                <span className="text-gray-700 truncate hidden sm:inline">{c.image}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Services</p>
        {services === null ? (
          <p className="text-[11px] text-gray-600">Loading…</p>
        ) : services.err ? (
          <p className="text-[11px] text-gray-600">{services.err}</p>
        ) : services.length === 0 ? (
          <p className="text-[11px] text-gray-600">No running services reported.</p>
        ) : (
          <ul className="space-y-0.5 max-h-36 overflow-y-auto">
            {services.map(s => (
              <li key={s.name} className="flex items-center gap-1.5 text-[11px] text-gray-400 min-w-0" title={s.description}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shrink-0" />
                <span className="truncate">{s.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// TagPill — a PVE guest tag.
function TagPill({ tag, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono transition-colors ${
        active ? 'bg-blue-500/25 text-blue-300' : 'bg-white/5 text-gray-500 hover:text-gray-300'
      }`}
    >
      #{tag}
    </button>
  )
}

// GuestCard is one VM/LXC as a self-contained, clickable service card: the card
// body opens the linked service in a new tab; the gear edits the link; power
// controls live at the bottom. Replaces the old in-node table rows.
function GuestCard({ item, type, nodeName, backup, noteCount, onOpenNotes, link, onServiceLinkChange, isInflight, onAction, onUpdate, ips, healthMap, pveURL, canInspect, onTagClick, activeTag }) {
  const running = item.status === 'running'
  const etype = type === 'VM' ? 'vm' : 'lxc'
  const pxType = type === 'VM' ? 'qemu' : 'lxc' // Proxmox API type
  const justDone = usePowerMorph(isInflight)
  const glow = useStatusGlow(item.status)
  const [showEditor, setShowEditor] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(null) // last action fired — drives the themed in-flight label
  const displayName = link?.label || item.name
  const key = `${pxType}:${item.vmid}`
  const health = healthMap?.[key]
  const ip = ips?.[key]?.[0]

  function handleCardClick() {
    if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
  }

  function copyIP(e) {
    e.stopPropagation()
    navigator.clipboard?.writeText(ip).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }

  const act = (action) => { setPending(action); onAction({ entityType: pxType, entityId: String(item.vmid), entityNode: nodeName, action }) }

  return (
    <Card
      className={`relative p-4 flex flex-col card-lift hover:border-white/20 ${glow || ''} ${link ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      {...cardA11y(link ? handleCardClick : null, `Open ${displayName}`)}
    >
      {/* Health dot + ext-link cue + gear — always visible, never hover-only */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        {link && <HealthDot health={health} />}
        {link && <span className="ext-cue text-gray-600 opacity-60" title="Has a service link"><IconExternalLink /></span>}
        <div className="relative">
          <button onClick={() => setShowEditor(v => !v)} className="gear-btn text-gray-600 hover:text-gray-400 transition-colors" title="Edit service link">
            <IconGear />
          </button>
          {showEditor && (
            <ServiceLinkEditor
              entityType={pxType} entityId={String(item.vmid)} link={link}
              onDone={onServiceLinkChange} onClose={() => setShowEditor(false)}
            />
          )}
        </div>
      </div>

      {/* Icon + name + vmid + IP */}
      <div className="flex items-center gap-2.5 mb-3 pr-12">
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-gray-500">
          <ServiceIcon
            entityType={pxType} entityId={String(item.vmid)} hasLink={!!link?.url} name={item.name}
            fallback={type === 'VM' ? <IconMonitor /> : <IconBox />}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{displayName}</h3>
          <p className="text-[11px] text-gray-600 font-mono flex items-center gap-1.5">
            {type}{item.vmid}
            {ip && (
              <button
                onClick={copyIP}
                title="Copy IP address"
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                {copied ? 'copied' : ip}
              </button>
            )}
          </p>
        </div>
      </div>

      {/* Status + backup + note badge + tags */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <StatusPill variant={statusVariant(item.status)}>{item.status}</StatusPill>
        <BackupBadge backup={backup} />
        {noteCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenNotes(etype, String(item.vmid)) }}
            title={`${noteCount} note${noteCount !== 1 ? 's' : ''} — open notebook`}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-gray-400 hover:bg-white/15 transition-colors"
          >
            <IconNoteSm /> {noteCount}
          </button>
        )}
        {(item.tags ?? []).map(t => (
          <span key={t} onClick={e => e.stopPropagation()}>
            <TagPill tag={t} active={activeTag === t} onClick={() => onTagClick?.(t)} />
          </span>
        ))}
      </div>

      {/* Extra service links — secondary apps on the same guest */}
      {link?.extras?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3" onClick={e => e.stopPropagation()}>
          {link.extras.map((x, i) => (
            <a
              key={i}
              href={x.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors"
            >
              <HealthDot health={healthMap?.[`${key}#${i}`]} />
              {x.label || new URL(x.url).host}
            </a>
          ))}
        </div>
      )}

      {/* Compact CPU / Memory / Storage gauges. Storage is N/A for VMs (the API
          reports no per-guest disk usage for QEMU); stopped guests read idle. */}
      <div className="flex items-start justify-around gap-1 mb-3" onClick={e => e.stopPropagation()}>
        <CompactGauge name="CPU" value={item.cpu} max={1} idle={!running} />
        <CompactGauge name="RAM" value={item.mem} max={item.maxmem} idle={!running} />
        <CompactGauge name="Disk" value={item.disk} max={item.maxdisk} idle={!running} />
      </div>

      {/* Power controls + console + details */}
      <div className="mt-auto pt-2 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          {isInflight ? (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500 animate-fade-in">
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              {copy(pending ? `action.${pending}` : 'action.working', 'Working…')}
            </span>
          ) : justDone ? (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 animate-fade-in">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Done
            </span>
          ) : running ? (
            <>
              <button onClick={() => act('shutdown')} className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                Shutdown
              </button>
              <button onClick={() => act('reboot')} className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                Reboot
              </button>
              {onUpdate && (
                <button onClick={() => onUpdate(item)} title="Update packages (apt update && upgrade)" className="text-[11px] px-1.5 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                  <IconUpdateSm />
                </button>
              )}
              <a
                href={consoleUrl(pveURL, nodeName, pxType, item.vmid)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open console in the Proxmox web UI"
                className="text-[11px] px-1.5 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconTerminal />
              </a>
              <button onClick={() => act('stop')} className="ml-auto text-[11px] text-gray-600 hover:text-red-400 transition-colors" title="Force stop — equivalent to pulling the power">
                Force stop
              </button>
            </>
          ) : (
            <button onClick={() => act('start')} className="text-[11px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
              Start
            </button>
          )}
          {canInspect && running && !isInflight && (
            <button
              onClick={() => setShowDetails(v => !v)}
              aria-expanded={showDetails}
              title="Show running services and docker containers"
              className={`text-[11px] px-1.5 py-1 rounded-md transition-colors ${showDetails ? 'bg-white/10 text-gray-200' : 'bg-white/5 text-gray-500 hover:text-gray-300'} ${running && !justDone ? '' : 'ml-auto'}`}
            >
              <span className={`inline-block transition-transform ${showDetails ? 'rotate-90' : ''}`}>▸</span>
            </button>
          )}
        </div>
        {showDetails && canInspect && running && (
          <GuestDetails vmid={String(item.vmid)} etype={pxType} />
        )}
      </div>
    </Card>
  )
}

// --- main ---
export default function Dashboard({ onLogout, theme, setTheme }) {
  const [view, setView] = useState('dashboard')
  const [navOpen, setNavOpen] = useState(false) // mobile drawer
  const [blip, setBlip] = useState(0) // bump → restarts the channel-tune static overlay (terminal theme)
  // Sidebar navigation: switch view and, under the terminal theme, fire a brief
  // static "channel-tune" blip. `extra` runs any per-view side effect first.
  const go = (v, extra) => { if (extra) extra(); setView(v); setNavOpen(false); if (theme === 'terminal') setBlip(b => b + 1) }
  const [pairedNodes, setPairedNodes] = useState([])
  const [activeNode, setActiveNode] = useState(null)

  // M10: service links, power action state, self-node detection
  const [serviceLinks, setServiceLinks] = useState({})
  const [selfNode, setSelfNode] = useState(null)
  const [pveURL, setPveURL] = useState('')
  const [inflight, setInflight] = useState({}) // key -> { prevStatus, timerId }
  const [confirm, setConfirm] = useState(null) // pending confirmation
  const [toast, setToast] = useState(null)
  const [updateJob, setUpdateJob] = useState(null) // { jobId, title } for the apt-upgrade log modal

  // Guest grid filters
  const [guestQuery, setGuestQuery] = useState('')
  const [activeTag, setActiveTag] = useState(null)
  const [runningOnly, setRunningOnly] = useState(false)

  useEffect(() => {
    getInfo().then(d => { setSelfNode(d?.self_node ?? null); setPveURL(d?.pve_url ?? '') }).catch(() => {})
    getServiceLinks().then(setServiceLinks).catch(() => {})
  }, [])

  // Guest IPs (server-cached, best-effort) — refresh every 2.5 min.
  const [guestIPs, setGuestIPs] = useState({})
  useEffect(() => {
    let live = true
    const load = () => getGuestIPs().then(d => live && setGuestIPs(d)).catch(() => {})
    load()
    const t = setInterval(load, 150000)
    return () => { live = false; clearInterval(t) }
  }, [])

  // Service health dots — the backend probes every 30 s; poll to match.
  const [healthMap, setHealthMap] = useState({})
  useEffect(() => {
    let live = true
    const load = () => getServiceHealth().then(d => live && setHealthMap(d)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => { live = false; clearInterval(t) }
  }, [])

  // Pending apt updates badge — cached server-side, cheap to poll.
  const [pendingUpdates, setPendingUpdates] = useState(0)
  useEffect(() => {
    let live = true
    const load = () => getUpdatesPending().then(d => live && setPendingUpdates(d.count ?? 0)).catch(() => {})
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => { live = false; clearInterval(t) }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const refreshNodes = useCallback(() => {
    getNodes().then(setPairedNodes).catch(() => setPairedNodes([]))
  }, [])
  useEffect(() => { refreshNodes() }, [refreshNodes])

  // If the active node was just removed, fall back to local.
  useEffect(() => {
    if (activeNode && !pairedNodes.some(n => n.id === activeNode)) setActiveNode(null)
  }, [pairedNodes, activeNode])

  const { nodes, connected, pulseKey, unreachable, disconnected } = useResourceStream(activeNode)
  const activeAddr = pairedNodes.find(n => n.id === activeNode)?.address

  // One-time "we're back" glow across the cards when the debounced disconnect
  // clears. Toggling the class off→on restarts the CSS animation each reconnect.
  const [reconnecting, setReconnecting] = useState(false)
  const prevDisc = useRef(disconnected)
  useEffect(() => {
    if (prevDisc.current && !disconnected) {
      setReconnecting(true)
      const t = setTimeout(() => setReconnecting(false), 600)
      prevDisc.current = disconnected
      return () => clearTimeout(t)
    }
    prevDisc.current = disconnected
  }, [disconnected])
  const dimmed = disconnected && nodes !== null

  // Clear inflight entries when the WS stream reflects a status change.
  useEffect(() => {
    if (!nodes || Object.keys(inflight).length === 0) return
    const statusMap = {}
    for (const n of nodes) {
      statusMap[`node:${n.id}`] = n.status
      for (const vm of n.vms) statusMap[`qemu:${vm.vmid}`] = vm.status
      for (const ct of n.lxcs) statusMap[`lxc:${ct.vmid}`] = ct.status
    }
    setInflight(prev => {
      const next = { ...prev }
      let changed = false
      for (const [key, { prevStatus, timerId }] of Object.entries(prev)) {
        if (statusMap[key] !== undefined && statusMap[key] !== prevStatus) {
          clearTimeout(timerId)
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [nodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshServiceLinks = useCallback(() => {
    getServiceLinks().then(setServiceLinks).catch(() => {})
  }, [])

  function handleAction({ entityType, entityId, entityNode, action, isSelf = false }) {
    // Wake-on-LAN is harmless (worst case: nothing happens) — no confirmation.
    const needsConfirm = (entityType === 'node' && action !== 'wake') || action === 'stop'
    if (needsConfirm) {
      setConfirm({ entityType, entityId, entityNode, action, isSelf })
    } else {
      executeAction({ entityType, entityId, entityNode, action })
    }
  }

  // Container apt upgrade: always confirmed (privileged in-guest mutation), then
  // streamed in the JobModal. Local LXCs only — see GuestCard's onUpdate wiring.
  function handleUpdate(item) {
    setConfirm({ entityType: 'lxc', entityId: String(item.vmid), action: 'update', name: item.name })
  }

  async function runUpdate(c) {
    try {
      const { job_id } = await updateContainer(c.entityId)
      setUpdateJob({ jobId: job_id, title: `Updating ${c.name || `CT ${c.entityId}`}` })
    } catch (e) {
      setToast(e.message)
    }
  }

  async function executeAction({ entityType, entityId, entityNode, action }) {
    const key = `${entityType}:${entityId}`
    let prevStatus = null
    for (const n of nodes ?? []) {
      if (entityType === 'node' && n.id === entityId) { prevStatus = n.status; break }
      for (const vm of n.vms) if (String(vm.vmid) === entityId) { prevStatus = vm.status; break }
      for (const ct of n.lxcs) if (String(ct.vmid) === entityId) { prevStatus = ct.status; break }
    }
    const timerId = setTimeout(() => {
      setInflight(prev => { const next = { ...prev }; delete next[key]; return next })
      setToast(`Action timed out for ${entityId} — check Proxmox for status.`)
    }, 30000)
    setInflight(prev => ({ ...prev, [key]: { prevStatus, timerId } }))
    try {
      await entityAction(entityType, entityId, entityNode ?? null, action)
    } catch (e) {
      clearTimeout(timerId)
      setInflight(prev => { const next = { ...prev }; delete next[key]; return next })
      setToast(e.message)
    }
  }

  // Backup status for the local cluster, refreshed every 5 min (matches the
  // server-side cache TTL). Only used when viewing the local host — a paired
  // node's vmids belong to a different cluster, so we don't map them here.
  const [backups, setBackups] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => getBackups().then(d => live && setBackups(d)).catch(() => live && setBackups(null))
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { live = false; clearInterval(t) }
  }, [])
  const backupByVmid = useMemo(() => {
    if (activeNode) return {} // local cluster only — see note above
    const m = {}
    for (const g of backups?.guests ?? []) m[g.vmid] = g
    return m
  }, [backups, activeNode])

  // Note counts per entity → small badge on VM/CT rows. Refreshed live when
  // notes are created/deleted in the Notebook, plus on mount.
  const [noteCounts, setNoteCounts] = useState([])
  const [notebookFilter, setNotebookFilter] = useState(null)
  const refreshCounts = useCallback(() => {
    getNoteCounts().then(setNoteCounts).catch(() => setNoteCounts([]))
  }, [])
  useEffect(() => { refreshCounts() }, [refreshCounts])
  const noteCountByEntity = useMemo(() => {
    const m = {}
    for (const c of noteCounts) m[`${c.entity_type}:${c.entity_id}`] = c.count
    return m
  }, [noteCounts])
  // Flat entity list (local cluster only) for the Notebook's entity pickers.
  const entities = useMemo(() => {
    const out = []
    for (const n of nodes ?? []) {
      out.push({ type: 'node', id: n.id, label: n.id })
      for (const vm of n.vms) out.push({ type: 'vm', id: String(vm.vmid), label: `VM ${vm.vmid} · ${vm.name}` })
      for (const ct of n.lxcs) out.push({ type: 'lxc', id: String(ct.vmid), label: `CT ${ct.vmid} · ${ct.name}` })
    }
    return out
  }, [nodes])
  const openNotesFor = useCallback((entity_type, entity_id) => {
    setNotebookFilter({ entity_type, entity_id })
    setView('notebook')
  }, [])

  const totalNodes = nodes?.length ?? 0
  const onlineNodes = nodes?.filter(n => n.status === 'online').length ?? 0
  const totalVMs = nodes?.reduce((s, n) => s + n.vms.length, 0) ?? 0
  const totalLXCs = nodes?.reduce((s, n) => s + n.lxcs.length, 0) ?? 0
  const avgCPU = nodes?.length
    ? nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length * 100
    : null

  // Guest filtering: search (name / vmid / link label), tag, running-only.
  const allTags = useMemo(() => {
    const s = new Set()
    for (const n of nodes ?? []) {
      for (const g of [...n.vms, ...n.lxcs]) for (const t of g.tags ?? []) s.add(t)
    }
    return [...s].sort()
  }, [nodes])
  const filtersActive = guestQuery.trim() !== '' || activeTag !== null || runningOnly
  const matchGuest = useCallback((g, pxType) => {
    if (runningOnly && g.status !== 'running') return false
    if (activeTag && !(g.tags ?? []).includes(activeTag)) return false
    const q = guestQuery.trim().toLowerCase()
    if (!q) return true
    const label = serviceLinks[`${pxType}:${g.vmid}`]?.label ?? ''
    return g.name.toLowerCase().includes(q) || String(g.vmid).includes(q) || label.toLowerCase().includes(q)
  }, [guestQuery, activeTag, runningOnly, serviceLinks])
  const toggleTag = useCallback((t) => setActiveTag(cur => (cur === t ? null : t)), [])

  async function handleLogout() {
    await logout()
    onLogout()
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#0c0c14] text-white overflow-hidden">

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#101018] border-b border-white/[0.06] shrink-0">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          className="text-gray-400 hover:text-white p-1 -ml-1 transition-colors"
        >
          <IconMenu />
        </button>
        <img src={logo} alt="" className="w-6 h-6 rounded-lg object-contain" />
        <span className="font-semibold text-sm tracking-tight">SuperDash</span>
        <span className="ml-auto flex items-center gap-2">
          <StatusDot pulseKey={pulseKey} connected={connected} disconnected={disconnected || unreachable} />
        </span>
      </header>

      {/* Drawer backdrop (mobile) */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar — static on desktop, slide-over drawer on mobile */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 md:static md:z-auto md:w-52 shrink-0 bg-[#101018] border-r border-white/[0.06] flex flex-col py-5 transform transition-transform duration-200 md:transform-none ${navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="px-4 mb-7 flex items-center gap-2.5">
          <img src={logo} alt="SuperDash" className="w-7 h-7 rounded-lg object-contain shrink-0" />
          <span className="font-semibold text-sm tracking-tight flex-1">SuperDash</span>
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="md:hidden text-gray-500 hover:text-white p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Node selector — points the dashboard/scripts/updates views at the
            local host or a paired secondary (main proxies the latter). */}
        <div className="px-3 mb-4">
          <label className="block text-[10px] uppercase tracking-wider text-gray-600 mb-1.5">Viewing</label>
          <select
            value={activeNode ?? ''}
            onChange={e => setActiveNode(e.target.value || null)}
            className="w-full bg-[#0c0c14] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
          >
            <option value="">This host (local)</option>
            {pairedNodes.map(n => (
              <option key={n.id} value={n.id}>{n.address}</option>
            ))}
          </select>
          {activeNode && (
            <p className="text-[10px] text-gray-600 mt-1.5">Applies to Dashboard &amp; Scripts.</p>
          )}
        </div>

        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          <NavItem icon={<IconGrid />} label="Dashboard" active={view === 'dashboard'} onClick={() => go('dashboard')} badge={pendingUpdates} />
          <NavItem icon={<IconTerminal />} label="Scripts" active={view === 'scripts'} onClick={() => go('scripts')} />
          <NavItem icon={<IconNote />} label="Notebook" active={view === 'notebook'} onClick={() => go('notebook', () => setNotebookFilter(null))} />
          <NavItem icon={<IconWifi />} label="Network" active={view === 'network'} onClick={() => go('network')} />
          <NavItem icon={<IconArchive />} label="Backups" active={view === 'backups'} onClick={() => go('backups')} />
          <NavItem icon={<IconActivity />} label="Activity" active={view === 'activity'} onClick={() => go('activity')} />
          <NavItem icon={<IconNetwork />} label="Nodes" active={view === 'nodes'} onClick={() => go('nodes')} />
          <NavItem icon={<IconSettings />} label="Settings" active={view === 'settings'} onClick={() => go('settings')} />
        </nav>

        <div className="px-2 pt-3 border-t border-white/[0.06]">
          <NavItem icon={<IconLogout />} label="Sign out" onClick={handleLogout} />
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

      <UpdateBanner />

      <ErrorBoundary resetKey={view}>

      {view === 'network' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold">Network</h1>
              <p className="text-xs text-gray-500 mt-0.5">Host network interfaces and bridges</p>
            </div>
            <LocalOnlyNote activeNode={activeNode} />
          </header>
          <Network />
        </>
      ) : view === 'backups' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold">Backups</h1>
              <p className="text-xs text-gray-500 mt-0.5">Last backup per guest and recent vzdump jobs</p>
            </div>
            <LocalOnlyNote activeNode={activeNode} />
          </header>
          <Backups />
        </>
      ) : view === 'activity' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold">Activity</h1>
              <p className="text-xs text-gray-500 mt-0.5">Dashboard jobs and the Proxmox cluster task log</p>
            </div>
            <LocalOnlyNote activeNode={activeNode} />
          </header>
          <Activity />
        </>
      ) : view === 'settings' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4">
            <h1 className="text-base font-semibold">Settings</h1>
            <p className="text-xs text-gray-500 mt-0.5">Appearance, security, notifications, and integrations</p>
          </header>
          <Settings theme={theme} setTheme={setTheme} />
        </>
      ) : view === 'nodes' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4">
            <h1 className="text-base font-semibold">Nodes</h1>
            <p className="text-xs text-gray-500 mt-0.5">Pair and manage secondary agents</p>
          </header>
          <Nodes nodes={pairedNodes} onChange={refreshNodes} />
        </>
      ) : view === 'scripts' ? (
        <div className="flex flex-col h-full">
          <header className="shrink-0 bg-[#0c0c14]/90 border-b border-white/[0.06] px-4 sm:px-8 py-4">
            <h1 className="text-base font-semibold">Script Catalog</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeAddr ? `Running on ${activeAddr}` : 'One-click community-scripts installs'}
            </p>
          </header>
          <Scripts node={activeNode} lxcs={entities.filter(e => e.type === 'lxc')} />
        </div>
      ) : view === 'notebook' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold">Notebook</h1>
              <p className="text-xs text-gray-500 mt-0.5">Timestamped notes — jot down the why, pin what matters</p>
            </div>
            <LocalOnlyNote activeNode={activeNode} />
          </header>
          <Notebook entities={entities} filter={notebookFilter} onCountsChanged={refreshCounts} />
        </>
      ) : (
        <>

        {/* Header */}
        <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Node Overview</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeAddr ? `Live resource usage — ${activeAddr}` : 'Live Proxmox resource usage'}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <StatusDot pulseKey={pulseKey} connected={connected} disconnected={disconnected || unreachable} />
            <span className="text-xs text-gray-500">
              {unreachable ? copy('status.lost', 'Unreachable')
                : disconnected ? copy('status.reconnecting', 'Reconnecting…')
                : copy('status.live', 'Live')}
            </span>
          </div>
        </header>

        <main className={`p-4 sm:p-8 space-y-6 max-w-[1600px] cards-region ${dimmed ? 'dimmed' : ''} ${reconnecting ? 'reconnect-pulse' : ''}`}>

          {/* Stat cards — dark elevated surface; no trend pills (no historical
              comparison data exists to compare against). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 stagger">
            <StatCard
              label="Nodes Online"
              loading={nodes === null}
              value={`${onlineNodes} / ${totalNodes}`}
              sub={totalNodes > 0 ? `${totalNodes} total` : undefined}
              icon={<IconServer />}
            />
            <StatCard
              label="Virtual Machines"
              loading={nodes === null}
              value={totalVMs}
              icon={<IconMonitor />}
            />
            <StatCard
              label="Containers"
              loading={nodes === null}
              value={totalLXCs}
              icon={<IconBox />}
            />
            <StatCard
              label="Avg CPU"
              loading={nodes === null}
              value={avgCPU === null ? '—' : avgCPU}
              format={(n) => `${n.toFixed(1)}%`}
              sub={nodes?.length ? `across ${nodes.length} node${nodes.length !== 1 ? 's' : ''}` : undefined}
              icon={<IconCpu />}
            />
          </div>

          {/* Node cards — degraded states share one consistent treatment. */}
          {unreachable ? (
            <DegradedNotice
              title="Node unreachable"
              detail={`Can't reach ${activeAddr || 'the node'} — the agent may be down or the network is interrupted. Retrying every 3 seconds.`}
            />
          ) : nodes === null ? (
            // First-paint skeletons — shimmer placeholders shaped like a node
            // card + its guests, shown only until the first WS frame arrives.
            <div className="space-y-6" aria-busy="true">
              <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6 space-y-4">
                <div className="skeleton h-4 w-40" />
                <div className="skeleton h-1.5 w-full" />
                <div className="skeleton h-1.5 w-full" />
                <div className="skeleton h-1.5 w-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="skeleton w-9 h-9 rounded-lg" />
                      <div className="space-y-1.5">
                        <div className="skeleton h-3 w-24" />
                        <div className="skeleton h-2.5 w-12" />
                      </div>
                    </div>
                    <div className="skeleton h-5 w-40" />
                  </div>
                ))}
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <DegradedNotice
              title={activeNode ? 'No data from node' : 'Proxmox unavailable'}
              detail={activeNode
                ? 'The node is reachable but reported no Proxmox resources — its API token may not be provisioned.'
                : 'No nodes reporting. Proxmox may be unavailable, or credentials are not provisioned yet.'}
            />
          ) : (
            <div className="space-y-6">
              {/* Guest filter bar — search, running-only, tag pills */}
              {(totalVMs + totalLXCs) > 3 && (
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="relative">
                    <input
                      value={guestQuery}
                      onChange={e => setGuestQuery(e.target.value)}
                      placeholder="Filter guests…"
                      aria-label="Filter guests by name, ID, or label"
                      className="w-44 sm:w-56 bg-[#13131e] border border-white/[0.07] rounded-xl pl-3 pr-7 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
                    />
                    {guestQuery && (
                      <button
                        onClick={() => setGuestQuery('')}
                        aria-label="Clear filter"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input type="checkbox" checked={runningOnly} onChange={e => setRunningOnly(e.target.checked)} className="accent-blue-500" />
                    Running only
                  </label>
                  {allTags.map(t => (
                    <TagPill key={t} tag={t} active={activeTag === t} onClick={() => toggleTag(t)} />
                  ))}
                </div>
              )}

              {nodes.map(node => {
                const vms = node.vms.filter(g => matchGuest(g, 'qemu'))
                const lxcs = node.lxcs.filter(g => matchGuest(g, 'lxc'))
                const hiddenCount = node.vms.length + node.lxcs.length - vms.length - lxcs.length
                return (
                <div key={node.id} className="space-y-3">
                  <NodeCard
                    node={node}
                    selfNode={selfNode}
                    serviceLinks={serviceLinks}
                    onServiceLinkChange={refreshServiceLinks}
                    inflight={inflight}
                    onAction={handleAction}
                    onInstallAgent={() => setView('nodes')}
                    localCluster={activeNode == null}
                  />
                  {(vms.length > 0 || lxcs.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 stagger">
                      {vms.map(vm => (
                        <GuestCard
                          key={`vm-${vm.vmid}`} item={vm} type="VM" nodeName={node.id}
                          backup={backupByVmid[vm.vmid]}
                          noteCount={noteCountByEntity[`vm:${vm.vmid}`] || 0}
                          onOpenNotes={openNotesFor}
                          link={serviceLinks[`qemu:${vm.vmid}`]}
                          onServiceLinkChange={refreshServiceLinks}
                          isInflight={!!inflight[`qemu:${vm.vmid}`]}
                          onAction={handleAction}
                          ips={activeNode == null ? guestIPs : undefined}
                          healthMap={activeNode == null ? healthMap : undefined}
                          pveURL={pveURL}
                          canInspect={activeNode == null}
                          onTagClick={toggleTag}
                          activeTag={activeTag}
                        />
                      ))}
                      {lxcs.map(ct => (
                        <GuestCard
                          key={`ct-${ct.vmid}`} item={ct} type="CT" nodeName={node.id}
                          backup={backupByVmid[ct.vmid]}
                          noteCount={noteCountByEntity[`lxc:${ct.vmid}`] || 0}
                          onOpenNotes={openNotesFor}
                          link={serviceLinks[`lxc:${ct.vmid}`]}
                          onServiceLinkChange={refreshServiceLinks}
                          isInflight={!!inflight[`lxc:${ct.vmid}`]}
                          onAction={handleAction}
                          onUpdate={activeNode == null ? handleUpdate : undefined}
                          ips={activeNode == null ? guestIPs : undefined}
                          healthMap={activeNode == null ? healthMap : undefined}
                          pveURL={pveURL}
                          canInspect={activeNode == null}
                          onTagClick={toggleTag}
                          activeTag={activeTag}
                        />
                      ))}
                    </div>
                  )}
                  {filtersActive && hiddenCount > 0 && (
                    <p className="text-xs text-gray-600 px-1">
                      {hiddenCount} guest{hiddenCount !== 1 ? 's' : ''} hidden by filters.
                    </p>
                  )}
                </div>
                )
              })}
            </div>
          )}

          {/* Updates — hidden while the node is unreachable (nothing to act on). */}
          {!unreachable && <Updates node={activeNode} />}

        </main>
        </>
      )}
      </ErrorBoundary>
      </div>

      {/* Confirmation modal for destructive power actions */}
      {confirm && (
        <ConfirmModal
          confirm={confirm}
          onConfirm={() => { const c = confirm; setConfirm(null); c.action === 'update' ? runUpdate(c) : executeAction(c) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Live apt-upgrade log for a container update */}
      {updateJob && (
        <JobModal jobId={updateJob.jobId} title={updateJob.title} onClose={() => setUpdateJob(null)} />
      )}

      {/* Section-transition static blip (terminal theme only; keyed so it replays) */}
      {theme === 'terminal' && blip > 0 && <div key={blip} className="crt-static run" />}

      {/* Error toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#13131e] border border-red-500/30 text-red-400 text-xs px-4 py-2.5 rounded-xl shadow-2xl max-w-xs">
          {copy('toast.fail', toast)}
        </div>
      )}
    </div>
  )
}
