import { useState, useEffect, useCallback, useMemo } from 'react'
import { logout, getNodes, getBackups, getNoteCounts, getInfo, entityAction, getServiceLinks, upsertServiceLink, deleteServiceLink } from '../lib/api'
import logo from '../../assets/logo.png'
import { useResourceStream } from '../hooks/useResourceStream'
import Updates from './Updates'
import Scripts from './Scripts'
import Themes from './Themes'
import Nodes from './Nodes'
import Network from './Network'
import Backups, { BackupBadge } from './Backups'
import Notebook from './Notebook'
import UpdateBanner from './UpdateBanner'

// --- helpers ---
function fmtBytes(n) {
  if (n == null) return '—'
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`
}
function fmtUptime(s) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h`
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
function IconPalette() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
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

// ConfirmModal — generic danger confirmation, reuses the Scripts.jsx pattern.
function ConfirmModal({ confirm, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const { entityType, entityId, action, isSelf } = confirm
  const isForceStop = action === 'stop'
  const isNodeAction = entityType === 'node'
  const verb = action === 'reboot' ? 'Reboot' : action === 'shutdown' ? 'Shut down' : 'Force stop'

  let title, body, danger = isForceStop
  if (isForceStop) {
    title = `Force stop ${entityId}?`
    body = 'This is the equivalent of pulling the power. The guest will not shut down gracefully and may lose unsaved data or corrupt the filesystem.'
  } else {
    title = `${verb} node ${entityId}?`
    body = `This will ${action} the node and interrupt every VM and container running on it.`
    if (isSelf) body += ' This is the node SuperDash is running on — this dashboard will disconnect until it comes back up.'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
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

// ServiceLinkEditor — popover for adding/editing/removing the URL linked to a card.
function ServiceLinkEditor({ entityType, entityId, link, onDone, onClose }) {
  const [url, setUrl] = useState(link?.url ?? '')
  const [label, setLabel] = useState(link?.label ?? '')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true); setErr(null)
    try {
      await upsertServiceLink(entityType, entityId, url, label || null)
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
    <div className="absolute top-6 right-0 z-40 bg-[#13131e] border border-white/20 rounded-xl p-3 shadow-2xl w-64" onClick={e => e.stopPropagation()}>
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
function NavItem({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
        active
          ? 'bg-white/10 text-white font-medium'
          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function StatCard({ title, value, sub, icon, bg, text, iconBg }) {
  return (
    <div className={`rounded-2xl p-5 ${bg}`}>
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center mb-6`}>
        <span className={text}>{icon}</span>
      </div>
      <p className={`text-xs font-medium mb-1.5 ${text} opacity-60`}>{title}</p>
      <p className={`text-2xl font-bold ${text}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${text} opacity-50`}>{sub}</p>}
    </div>
  )
}

function Bar({ value, max }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color = p > 90 ? 'bg-red-500' : p > 70 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${p}%` }} />
    </div>
  )
}

function StatusPill({ status }) {
  const on = status === 'running' || status === 'online'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/8 text-gray-500'
    }`}>
      {status}
    </span>
  )
}

function StatusDot({ pulseKey, connected }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {connected && (
        <span key={pulseKey} className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping-once" />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`} />
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
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400">
      <IconEye />
      Monitor only
    </span>
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

function NodeCard({ node, selfNode, serviceLinks, onServiceLinkChange, inflight, onAction, onInstallAgent }) {
  const monitorOnly = node.managed === false
  const link = serviceLinks[`node:${node.id}`]
  const isInflight = !!inflight[`node:${node.id}`]
  const [showEditor, setShowEditor] = useState(false)

  function handleCardClick() {
    if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
  }

  return (
    <div
      className={`bg-[#13131e] border border-white/[0.07] rounded-2xl p-6 relative ${link ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
    >
      {/* Gear + external-link indicators — always visible, never hover-only */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        {link && <span className="text-gray-600 opacity-50"><IconExternalLink /></span>}
        <div className="relative">
          <button
            onClick={() => setShowEditor(v => !v)}
            className="text-gray-600 hover:text-gray-400 transition-colors"
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

      <div className="flex items-start justify-between mb-5 gap-2 pr-12">
        <div>
          <h2 className="text-sm font-semibold text-white">{node.id}</h2>
          <p className="text-xs text-gray-600 mt-0.5">up {fmtUptime(node.uptime)}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {monitorOnly && <MonitorOnlyBadge />}
          <StatusPill status={node.status} />
        </div>
      </div>

      <div className="space-y-4 mb-5">
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-gray-500">CPU</span>
            <span className="text-gray-400">{(node.cpu * 100).toFixed(1)}% of {node.maxcpu} cores</span>
          </div>
          <Bar value={node.cpu} max={1} />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-gray-500">Memory</span>
            <span className="text-gray-400">{fmtBytes(node.mem)} / {fmtBytes(node.maxmem)}</span>
          </div>
          <Bar value={node.mem} max={node.maxmem} />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-gray-500">Disk</span>
            <span className="text-gray-400">{fmtBytes(node.disk)} / {fmtBytes(node.maxdisk)}</span>
          </div>
          <Bar value={node.disk} max={node.maxdisk} />
        </div>
      </div>

      {/* Node power controls */}
      <div className="border-t border-white/[0.06] pt-4 mt-1 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button
          disabled={isInflight}
          onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'reboot', isSelf: node.id === selfNode })}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
        >
          Reboot
        </button>
        <button
          disabled={isInflight}
          onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'shutdown', isSelf: node.id === selfNode })}
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
        >
          Shutdown
        </button>
        {isInflight && (
          <svg className="animate-spin text-gray-500 ml-1" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        )}
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
    </div>
  )
}

// ServiceIcon shows the linked service's favicon (so an Immich card shows the
// Immich logo, etc.), falling back to a generic VM/CT glyph if there's no link
// or the favicon fails to load.
function ServiceIcon({ url, fallback }) {
  const [failed, setFailed] = useState(false)
  let origin = null
  if (url) {
    try { origin = new URL(url).origin } catch { /* invalid — use fallback */ }
  }
  if (!origin || failed) return fallback
  return (
    <img
      src={`${origin}/favicon.ico`}
      alt=""
      className="w-6 h-6 rounded object-contain"
      onError={() => setFailed(true)}
    />
  )
}

// GuestCard is one VM/LXC as a self-contained, clickable service card: the card
// body opens the linked service in a new tab; the gear edits the link; power
// controls live at the bottom. Replaces the old in-node table rows.
function GuestCard({ item, type, nodeName, backup, noteCount, onOpenNotes, link, onServiceLinkChange, isInflight, onAction }) {
  const running = item.status === 'running'
  const etype = type === 'VM' ? 'vm' : 'lxc'
  const pxType = type === 'VM' ? 'qemu' : 'lxc' // Proxmox API type
  const [showEditor, setShowEditor] = useState(false)
  const displayName = link?.label || item.name

  function handleCardClick() {
    if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
  }

  const act = (action) => onAction({ entityType: pxType, entityId: String(item.vmid), entityNode: nodeName, action })

  return (
    <div
      className={`relative bg-[#13131e] border border-white/[0.07] rounded-2xl p-4 flex flex-col transition-colors ${link ? 'cursor-pointer hover:border-white/20' : ''}`}
      onClick={handleCardClick}
    >
      {/* Gear + external-link indicator — always visible, never hover-only */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        {link && <span className="text-gray-600 opacity-60" title="Has a service link"><IconExternalLink /></span>}
        <div className="relative">
          <button onClick={() => setShowEditor(v => !v)} className="text-gray-600 hover:text-gray-400 transition-colors" title="Edit service link">
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

      {/* Icon + name */}
      <div className="flex items-center gap-2.5 mb-3 pr-12">
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-gray-500">
          <ServiceIcon url={link?.url} fallback={type === 'VM' ? <IconMonitor /> : <IconBox />} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{displayName}</h3>
          <p className="text-[11px] text-gray-600 font-mono">{type}{item.vmid}</p>
        </div>
      </div>

      {/* Status + live stats + note badge */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <StatusPill status={item.status} />
        {running && (
          <span className="text-[11px] text-gray-500 tabular-nums">
            {(item.cpu * 100).toFixed(1)}% · {fmtBytes(item.mem)}
          </span>
        )}
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
      </div>

      {/* Power controls */}
      <div className="mt-auto pt-2 border-t border-white/[0.06] flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        {isInflight ? (
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            Working…
          </span>
        ) : running ? (
          <>
            <button onClick={() => act('shutdown')} className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
              Shutdown
            </button>
            <button onClick={() => act('reboot')} className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
              Reboot
            </button>
            <button onClick={() => act('stop')} className="ml-auto text-[11px] text-gray-600 hover:text-red-400 transition-colors" title="Force stop — equivalent to pulling the power">
              Force stop
            </button>
          </>
        ) : (
          <button onClick={() => act('start')} className="text-[11px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
            Start
          </button>
        )}
      </div>
    </div>
  )
}

// --- main ---
export default function Dashboard({ onLogout, theme, setTheme }) {
  const [view, setView] = useState('dashboard')
  const [pairedNodes, setPairedNodes] = useState([])
  const [activeNode, setActiveNode] = useState(null)

  // M10: service links, power action state, self-node detection
  const [serviceLinks, setServiceLinks] = useState({})
  const [selfNode, setSelfNode] = useState(null)
  const [inflight, setInflight] = useState({}) // key -> { prevStatus, timerId }
  const [confirm, setConfirm] = useState(null) // pending confirmation
  const [toast, setToast] = useState(null)

  useEffect(() => {
    getInfo().then(d => setSelfNode(d?.self_node ?? null)).catch(() => {})
    getServiceLinks().then(setServiceLinks).catch(() => {})
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

  const { nodes, connected, pulseKey, unreachable } = useResourceStream(activeNode)
  const activeAddr = pairedNodes.find(n => n.id === activeNode)?.address

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
    const needsConfirm = entityType === 'node' || action === 'stop'
    if (needsConfirm) {
      setConfirm({ entityType, entityId, entityNode, action, isSelf })
    } else {
      executeAction({ entityType, entityId, entityNode, action })
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
    ? (nodes.reduce((s, n) => s + n.cpu, 0) / nodes.length * 100).toFixed(1)
    : null

  async function handleLogout() {
    await logout()
    onLogout()
  }

  return (
    <div className="flex h-screen bg-[#0c0c14] text-white overflow-hidden">

      {/* Sidebar */}
      <aside className="w-52 shrink-0 bg-[#101018] border-r border-white/[0.06] flex flex-col py-5">
        <div className="px-4 mb-7">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="SuperDash" className="w-7 h-7 rounded-lg object-contain shrink-0" />
            <span className="font-semibold text-sm tracking-tight">SuperDash</span>
          </div>
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
        </div>

        <nav className="flex-1 px-2 space-y-0.5">
          <NavItem icon={<IconGrid />} label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <NavItem icon={<IconTerminal />} label="Scripts" active={view === 'scripts'} onClick={() => setView('scripts')} />
          <NavItem icon={<IconNote />} label="Notebook" active={view === 'notebook'} onClick={() => { setNotebookFilter(null); setView('notebook') }} />
          <NavItem icon={<IconWifi />} label="Network" active={view === 'network'} onClick={() => setView('network')} />
          <NavItem icon={<IconArchive />} label="Backups" active={view === 'backups'} onClick={() => setView('backups')} />
          <NavItem icon={<IconNetwork />} label="Nodes" active={view === 'nodes'} onClick={() => setView('nodes')} />
          <NavItem icon={<IconPalette />} label="Themes" active={view === 'themes'} onClick={() => setView('themes')} />
        </nav>

        <div className="px-2 pt-3 border-t border-white/[0.06]">
          <NavItem icon={<IconLogout />} label="Sign out" onClick={handleLogout} />
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

      <UpdateBanner />

      {view === 'themes' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Appearance</h1>
            <p className="text-xs text-gray-500 mt-0.5">Choose a colour theme</p>
          </header>
          <Themes theme={theme} setTheme={setTheme} />
        </>
      ) : view === 'network' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Network</h1>
            <p className="text-xs text-gray-500 mt-0.5">Host network interfaces and bridges</p>
          </header>
          <Network />
        </>
      ) : view === 'backups' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Backups</h1>
            <p className="text-xs text-gray-500 mt-0.5">Last backup per guest and recent vzdump jobs</p>
          </header>
          <Backups />
        </>
      ) : view === 'nodes' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Nodes</h1>
            <p className="text-xs text-gray-500 mt-0.5">Pair and manage secondary agents</p>
          </header>
          <Nodes nodes={pairedNodes} onChange={refreshNodes} />
        </>
      ) : view === 'scripts' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Script Catalog</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeAddr ? `Running on ${activeAddr}` : 'One-click community-scripts installs'}
            </p>
          </header>
          <Scripts node={activeNode} />
        </>
      ) : view === 'notebook' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Notebook</h1>
            <p className="text-xs text-gray-500 mt-0.5">Timestamped notes — jot down the why, pin what matters</p>
          </header>
          <Notebook entities={entities} filter={notebookFilter} onCountsChanged={refreshCounts} />
        </>
      ) : (
        <>

        {/* Header */}
        <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Node Overview</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeAddr ? `Live resource usage — ${activeAddr}` : 'Live Proxmox resource usage'}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <StatusDot pulseKey={pulseKey} connected={connected} />
            <span className="text-xs text-gray-500">
              {unreachable ? 'Unreachable' : connected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
        </header>

        <main className="p-8 space-y-6 max-w-6xl">

          {/* Stat cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              title="Nodes Online"
              value={nodes === null ? '—' : `${onlineNodes} / ${totalNodes}`}
              sub={totalNodes > 0 ? `${totalNodes} total` : undefined}
              icon={<IconServer />}
              bg="bg-[#c6edda]" text="text-[#1a4530]" iconBg="bg-[#a8dfc0]"
            />
            <StatCard
              title="Virtual Machines"
              value={nodes === null ? '—' : totalVMs}
              icon={<IconMonitor />}
              bg="bg-[#e8e8f4]" text="text-[#1a1a3a]" iconBg="bg-[#d0d0ea]"
            />
            <StatCard
              title="Containers"
              value={nodes === null ? '—' : totalLXCs}
              icon={<IconBox />}
              bg="bg-[#fef9c3]" text="text-[#3a2e00]" iconBg="bg-[#fef08a]"
            />
            <StatCard
              title="Avg CPU"
              value={avgCPU === null ? '—' : `${avgCPU}%`}
              sub={nodes?.length ? `across ${nodes.length} node${nodes.length !== 1 ? 's' : ''}` : undefined}
              icon={<IconCpu />}
              bg="bg-[#e4dcf8]" text="text-[#2d1a4a]" iconBg="bg-[#c4aef0]"
            />
          </div>

          {/* Node cards — degraded states share one consistent treatment. */}
          {unreachable ? (
            <DegradedNotice
              title="Node unreachable"
              detail={`Can't reach ${activeAddr || 'the node'} — the agent may be down or the network is interrupted. Retrying every 3 seconds.`}
            />
          ) : nodes === null ? (
            <div className="text-center py-16 text-gray-600 text-sm">
              {activeAddr ? `Connecting to ${activeAddr}…` : 'Connecting to Proxmox…'}
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
              {nodes.map(node => (
                <div key={node.id} className="space-y-3">
                  <NodeCard
                    node={node}
                    selfNode={selfNode}
                    serviceLinks={serviceLinks}
                    onServiceLinkChange={refreshServiceLinks}
                    inflight={inflight}
                    onAction={handleAction}
                    onInstallAgent={() => setView('nodes')}
                  />
                  {(node.vms.length > 0 || node.lxcs.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {node.vms.map(vm => (
                        <GuestCard
                          key={`vm-${vm.vmid}`} item={vm} type="VM" nodeName={node.id}
                          backup={backupByVmid[vm.vmid]}
                          noteCount={noteCountByEntity[`vm:${vm.vmid}`] || 0}
                          onOpenNotes={openNotesFor}
                          link={serviceLinks[`qemu:${vm.vmid}`]}
                          onServiceLinkChange={refreshServiceLinks}
                          isInflight={!!inflight[`qemu:${vm.vmid}`]}
                          onAction={handleAction}
                        />
                      ))}
                      {node.lxcs.map(ct => (
                        <GuestCard
                          key={`ct-${ct.vmid}`} item={ct} type="CT" nodeName={node.id}
                          backup={backupByVmid[ct.vmid]}
                          noteCount={noteCountByEntity[`lxc:${ct.vmid}`] || 0}
                          onOpenNotes={openNotesFor}
                          link={serviceLinks[`lxc:${ct.vmid}`]}
                          onServiceLinkChange={refreshServiceLinks}
                          isInflight={!!inflight[`lxc:${ct.vmid}`]}
                          onAction={handleAction}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Updates — hidden while the node is unreachable (nothing to act on). */}
          {!unreachable && <Updates node={activeNode} />}

        </main>
        </>
      )}
      </div>

      {/* Confirmation modal for destructive power actions */}
      {confirm && (
        <ConfirmModal
          confirm={confirm}
          onConfirm={() => { const c = confirm; setConfirm(null); executeAction(c) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Error toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#13131e] border border-red-500/30 text-red-400 text-xs px-4 py-2.5 rounded-xl shadow-2xl max-w-xs">
          {toast}
        </div>
      )}
    </div>
  )
}
