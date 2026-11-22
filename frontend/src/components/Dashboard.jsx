import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  logout, getNodes, getBackups, getNoteCounts, getInfo, entityAction, updateContainer,
  getServiceLinks, getServiceHealth, getGuestIPs, getUpdatesPending,
  getUpdateCheck, getActiveJob, cancelJob,
} from '../lib/api'
import { THEMES } from '../hooks/useTheme'
import { ShapeMagicLogo } from './ShapeMagicLogo'
import { useResourceStream } from '../hooks/useResourceStream'
import { useJobStream } from '../hooks/useJobStream'
import Terminal from './Terminal'
import Updates from './Updates'
import LXCBatchUpdate from './LXCBatchUpdate'
import Scripts from './Scripts'
import Nodes from './Nodes'
import Network from './Network'
import Hardware from './Hardware'
import Backups from './Backups'
import Schedules from './Schedules'
import Notebook from './Notebook'
import Activity from './Activity'
import Settings from './Settings'
import ErrorBoundary from './ErrorBoundary'
import UpdateBanner, { UpdateHeaderPill } from './UpdateBanner'
import { Card, StatCard, StatusPill } from './Card'
import NodeCard, { fmtPair } from './NodeCard'
import { GuestCard, GuestRow, TagPill } from './GuestCard'
import GuestDrawer from './GuestDrawer'
import CommandPalette, { THEME_SWATCHES } from './CommandPalette'
import { ThemedHeading, ShinyText, Magnet, StarBorder } from './ReactBits'
import {
  IconGrid, IconTerminal, IconLogout, IconServer, IconMonitor, IconBox,
  IconCpu, IconNetwork, IconHardware, IconWifi, IconArchive, IconCalendarClock,
  IconNote, IconActivity, IconSettings, IconMenu, IconWarnSm, IconSearch,
  IconPalette, IconList,
} from './Icons'
import {
  useViewTransition, useScrollReveal, useModalEntrance, useStaggerMount,
  ScrollProgressBar, useSlidingIndicator,
} from './motion'
import { ScrollContainerContext, useSmoothScroll } from '../hooks/useSmoothScroll'
import { copy } from '../lib/copy'
import { useFocusTrap } from '../lib/a11y'

// JobModal — streams a running executor job's live output and allows cancellation.
function JobModal({ jobId, node = null, title, onClose }) {
  const { output, state, sendInput } = useJobStream(jobId, node)
  const [cancelling, setCancelling] = useState(false)
  const trap = useFocusTrap()
  const backdropRef = useRef(null)
  useModalEntrance(backdropRef, trap)

  async function handleCancel() {
    setCancelling(true)
    try { await cancelJob(jobId, node) }
    catch { /* surfaced via stream */ }
    finally { setCancelling(false) }
  }

  return (
    <div ref={backdropRef} data-lenis-prevent className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={trap} role="dialog" aria-modal="true" aria-label={title} className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-white truncate">{title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {state === 'running' && (
              <>
                <StatusPill variant="neutral">Running…</StatusPill>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                >
                  {cancelling ? 'Stopping…' : 'Cancel'}
                </button>
              </>
            )}
            {state === 'succeeded' && <StatusPill variant="success">Done</StatusPill>}
            {state === 'cancelled' && <StatusPill variant="warning">Cancelled</StatusPill>}
            {state === 'failed' && <StatusPill variant="error">Failed</StatusPill>}
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-sm p-1">✕</button>
          </div>
        </div>
        <Terminal output={output} state={state} sendInput={sendInput} />
      </div>
    </div>
  )
}

const ACTIVE_JOB_LABELS = {
  apt_upgrade: 'Host update',
  ct_upgrade: 'LXC update',
  lxc_batch_upgrade: 'Batch LXCs',
  catalog_script: 'Script install',
  sched_host_update: 'Scheduled host update',
  sched_ct_update: 'Scheduled LXC update',
  sched_lxc_batch_update: 'Scheduled batch LXCs',
  sched_backup: 'Scheduled backup',
  sched_snapshot: 'Scheduled snapshot',
  sched_power: 'Scheduled power',
  sched_speedtest: 'Scheduled speedtest',
}

function ActiveJobPill({ job, onClick }) {
  if (!job) return null
  const label = ACTIVE_JOB_LABELS[job.type] || job.type || 'Job'
  return (
    <button
      type="button"
      onClick={onClick}
      title="A job is running — click to view live output or cancel"
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      <span className="hidden sm:inline">{label}…</span>
      <span className="sm:hidden">Running…</span>
    </button>
  )
}

function ConfirmModal({ confirm, onConfirm, onCancel }) {
  const trap = useFocusTrap()
  const backdropRef = useRef(null)
  useModalEntrance(backdropRef, trap)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const { entityId, action, isSelf, name } = confirm
  const isForceStop = action === 'stop'
  const isUpdate = action === 'update'
  const verb = isUpdate ? 'Update' : action === 'reboot' ? 'Reboot' : action === 'shutdown' ? 'Shut down' : 'Force stop'

  let title, body, danger = isForceStop
  if (isUpdate) {
    title = `Update ${name || `container ${entityId}`}?`
    body = 'Runs a non-interactive package upgrade (apt-get / apk / dnf) inside the container. It must be running; the upgrade can restart services inside it.'
  } else if (isForceStop) {
    title = `Force stop ${entityId}?`
    body = copy('confirm.forceStop', 'This is the equivalent of pulling the power. The guest will not shut down gracefully and may lose unsaved data or corrupt the filesystem.')
  } else {
    title = `${verb} node ${entityId}?`
    body = copy('confirm.node', `This will ${action} the node and interrupt every VM and container running on it.`)
    if (isSelf) body += ' ' + copy('confirm.selfNode', 'This is the node SuperDash is running on — this dashboard will disconnect until it comes back up.')
  }

  return (
    <div ref={backdropRef} data-lenis-prevent className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onCancel}>
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

function NavSectionLabel({ children }) {
  return (
    <p className="px-3 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600 select-none">
      {children}
    </p>
  )
}

function NavItem({ icon, label, active, onClick, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative z-10 w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-colors ${
        active
          ? 'text-white font-medium'
          : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {badge > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium tabular-nums">
          {badge}
        </span>
      )}
    </button>
  )
}

function LocalOnlyNote({ activeNode }) {
  if (!activeNode) return null
  return (
    <StatusPill variant="warning" title="The node selector doesn't apply here — this tab always shows the local host.">
      local host only
    </StatusPill>
  )
}

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

function DegradedNotice({ title, detail }) {
  return (
    <div className="bg-[#13131e] border border-amber-500/20 rounded-2xl p-10 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 mb-3">
        <IconWarnSm />
      </div>
      <p className="text-sm text-gray-300 font-medium">{title}</p>
      <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">{detail}</p>
    </div>
  )
}

function ErrorToast({ message, theme }) {
  const ref = useRef(null)
  useStaggerMount(ref, null, { theme, deps: [message] })
  return (
    <div ref={ref} className="fixed bottom-4 right-4 z-50 bg-[#13131e] border border-red-500/30 text-red-400 text-xs px-4 py-2.5 rounded-xl shadow-2xl max-w-xs">
      {copy('toast.fail', message)}
    </div>
  )
}

// SidebarThemePicker — compact 1-click theme/template switcher in the sidebar footer.
function SidebarThemePicker({ theme, setTheme }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const current = THEMES.find(t => t.id === theme) || THEMES[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title="Switch dashboard theme"
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        <span
          className="w-3.5 h-3.5 rounded-full border border-white/25 shrink-0"
          style={{ background: THEME_SWATCHES[current.id] }}
        />
        <span className="flex-1 text-left truncate">{current.name}</span>
        <span className="text-gray-500"><IconPalette size={14} /></span>
      </button>

      {open && (
        <div
          data-lenis-prevent
          className="cmd-palette absolute bottom-full left-0 right-0 mb-2 z-50 bg-[#13131e] border border-white/15 rounded-xl p-1.5 shadow-2xl space-y-0.5"
        >
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Theme Template
          </p>
          {THEMES.map(t => {
            const active = t.id === theme
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTheme(t.id); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  active ? 'bg-white/10 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full border border-white/25 shrink-0"
                  style={{ background: THEME_SWATCHES[t.id] }}
                />
                <span className="flex-1 text-left truncate">{t.name}</span>
                {active && <span className="text-emerald-400 text-[10px]">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Unified sticky header across every tab so layout, spacing, Command Palette
// trigger, ActiveJobPill, and status indicators stay 100% consistent.
function AppHeader({
  title,
  subtitle,
  sticky = true,
  theme,
  onOpenPalette,
  activeJob,
  onOpenJob,
  appUpdate,
  updateBannerOpen,
  onToggleUpdateBanner,
  localOnly,
  activeNode,
  rebootRequired,
  liveStatus,
}) {
  return (
    <header className={`${sticky ? 'sticky top-0 z-10' : 'shrink-0'} bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-3`}>
      <div className="min-w-0">
        <h1 className="text-base font-semibold text-white tracking-tight truncate">
          <ThemedHeading text={title} theme={theme} />
        </h1>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {rebootRequired && <StatusPill variant="warning">Reboot required</StatusPill>}
        <ActiveJobPill job={activeJob} onClick={onOpenJob} />
        <UpdateHeaderPill info={appUpdate} open={updateBannerOpen} onClick={onToggleUpdateBanner} />
        {localOnly && <LocalOnlyNote activeNode={activeNode} />}

        <Magnet strength={0.14} theme={theme}>
          <StarBorder>
            <button
              type="button"
              onClick={onOpenPalette}
              title="Open Command Palette (Cmd+K / Ctrl+K)"
              className="cmd-trigger inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-[11px] bg-[#13131e] border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors"
            >
              <IconSearch size={13} />
              <span className="hidden lg:inline">Search…</span>
              <kbd className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/8 text-gray-500">
                ⌘K
              </kbd>
            </button>
          </StarBorder>
        </Magnet>

        {liveStatus && (
          <div className="hidden sm:flex items-center gap-2 pl-1">
            <StatusDot pulseKey={liveStatus.pulseKey} connected={liveStatus.connected} disconnected={liveStatus.disconnected} />
            <span className="text-xs text-gray-500">
              {liveStatus.unreachable ? copy('status.lost', 'Unreachable')
                : liveStatus.disconnected ? copy('status.reconnecting', 'Reconnecting…')
                : copy('status.live', 'Live')}
            </span>
          </div>
        )}
      </div>
    </header>
  )
}

export default function Dashboard({ onLogout, theme, setTheme }) {
  const [view, setView] = useState('dashboard')
  const [navOpen, setNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [blip, setBlip] = useState(0)

  const scrollWrapperRef = useRef(null)
  const scrollContentRef = useRef(null)
  const viewRef = useRef(null)
  const overviewMainRef = useRef(null)
  const navRef = useRef(null)
  const navPillRef = useRef(null)

  const go = useCallback((v, extra) => {
    if (extra) extra()
    setView(v)
    setNavOpen(false)
    if (theme === 'terminal') setBlip(b => b + 1)
  }, [theme])

  const [pairedNodes, setPairedNodes] = useState([])
  const [activeNode, setActiveNode] = useState(null)
  const [serviceLinks, setServiceLinks] = useState({})
  const [selfNode, setSelfNode] = useState(null)
  const [pveURL, setPveURL] = useState('')
  const [appUpdate, setAppUpdate] = useState(null)
  const [updateBannerOpen, setUpdateBannerOpen] = useState(false)
  const [inflight, setInflight] = useState({})
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [updateJob, setUpdateJob] = useState(null)

  // Inspected guest reference (live-resolved from WS nodes so open drawer stays real-time)
  const [inspectedRef, setInspectedRef] = useState(null) // { type, vmid, nodeName }

  // Guest toolbar state (search, kind, running-only, sort, layout, tag)
  const [guestQuery, setGuestQuery] = useState('')
  const [guestKind, setGuestKind] = useState('all') // 'all' | 'vm' | 'lxc'
  const [guestSort, setGuestSort] = useState('vmid') // 'vmid' | 'name' | 'cpu' | 'mem'
  const [guestLayout, setGuestLayout] = useState(() => localStorage.getItem('sd-guest-layout') || 'grid')
  const [activeTag, setActiveTag] = useState(null)
  const [runningOnly, setRunningOnly] = useState(false)

  useEffect(() => {
    localStorage.setItem('sd-guest-layout', guestLayout)
  }, [guestLayout])

  // Global Cmd+K / Ctrl+K shortcut for Command Palette
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    getInfo().then(d => { setSelfNode(d?.self_node ?? null); setPveURL(d?.pve_url ?? '') }).catch(() => {})
    getServiceLinks().then(setServiceLinks).catch(() => {})
    getUpdateCheck().then(setAppUpdate).catch(() => {})
    const t = setInterval(() => getUpdateCheck().then(setAppUpdate).catch(() => {}), 6 * 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const [guestIPs, setGuestIPs] = useState({})
  useEffect(() => {
    let live = true
    const load = () => getGuestIPs().then(d => live && setGuestIPs(d)).catch(() => {})
    load()
    const t = setInterval(load, 150000)
    return () => { live = false; clearInterval(t) }
  }, [])

  const [healthMap, setHealthMap] = useState({})
  useEffect(() => {
    let live = true
    const load = () => getServiceHealth().then(d => live && setHealthMap(d)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => { live = false; clearInterval(t) }
  }, [])

  const [pendingUpdates, setPendingUpdates] = useState(0)
  const [rebootRequired, setRebootRequired] = useState(false)
  useEffect(() => {
    let live = true
    const load = () => getUpdatesPending(activeNode).then(d => {
      if (!live) return
      setPendingUpdates(d.count ?? 0)
      setRebootRequired(Boolean(d.reboot_required))
    }).catch(() => {})
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => { live = false; clearInterval(t) }
  }, [activeNode])

  const [activeJob, setActiveJob] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => getActiveJob(activeNode).then(d => {
      if (live) setActiveJob(d?.active ? d.job : null)
    }).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => { live = false; clearInterval(t) }
  }, [activeNode])

  const openActiveJobModal = useCallback(() => {
    if (!activeJob) return
    const label = ACTIVE_JOB_LABELS[activeJob.type] || activeJob.type || 'Running job'
    setUpdateJob({ jobId: activeJob.id, node: activeNode, title: label })
  }, [activeJob, activeNode])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const refreshNodes = useCallback(() => {
    getNodes().then(setPairedNodes).catch(() => setPairedNodes([]))
  }, [])
  useEffect(() => { refreshNodes() }, [refreshNodes])

  useEffect(() => {
    if (activeNode && !pairedNodes.some(n => n.id === activeNode)) setActiveNode(null)
  }, [pairedNodes, activeNode])

  const { nodes, connected, pulseKey, unreachable, disconnected } = useResourceStream(activeNode)
  const activePaired = pairedNodes.find(n => n.id === activeNode)
  const activeAddr = activePaired ? (activePaired.node_name ? `${activePaired.node_name} (${activePaired.address})` : activePaired.address) : undefined

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
    const needsConfirm = (entityType === 'node' && action !== 'wake') || action === 'stop'
    if (needsConfirm) {
      setConfirm({ entityType, entityId, entityNode, action, isSelf })
    } else {
      executeAction({ entityType, entityId, entityNode, action })
    }
  }

  function handleUpdate(item) {
    setConfirm({ entityType: 'lxc', entityId: String(item.vmid), action: 'update', name: item.name })
  }

  async function runUpdate(c) {
    try {
      const { job_id } = await updateContainer(c.entityId, activeNode)
      setUpdateJob({ jobId: job_id, node: activeNode, title: `Updating ${c.name || `CT ${c.entityId}`}` })
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

  const [backups, setBackups] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => getBackups().then(d => live && setBackups(d)).catch(() => live && setBackups(null))
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => { live = false; clearInterval(t) }
  }, [])
  const backupByVmid = useMemo(() => {
    if (activeNode) return {}
    const m = {}
    for (const g of backups?.guests ?? []) m[g.vmid] = g
    return m
  }, [backups, activeNode])

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

  // Resolve inspected guest live from WS nodes
  const inspectedGuest = useMemo(() => {
    if (!inspectedRef) return null
    for (const n of nodes ?? []) {
      if (n.id !== inspectedRef.nodeName) continue
      const list = inspectedRef.type === 'VM' ? n.vms : n.lxcs
      const found = list.find(g => g.vmid === inspectedRef.vmid)
      if (found) return { item: found, type: inspectedRef.type, nodeName: n.id, managed: n.managed !== false }
    }
    return null
  }, [inspectedRef, nodes])

  const handleInspectGuest = useCallback(({ item, type, nodeName }) => {
    setInspectedRef({ type, vmid: item.vmid, nodeName })
  }, [])

  // KPI aggregations
  const kpi = useMemo(() => {
    const list = nodes ?? []
    const totalNodes = list.length
    const onlineNodes = list.filter(n => n.status === 'online').length
    let totalVMs = 0, runningVMs = 0, totalLXCs = 0, runningLXCs = 0
    let memUsed = 0, memTotal = 0, cpuSum = 0
    for (const n of list) {
      totalVMs += n.vms.length
      runningVMs += n.vms.filter(v => v.status === 'running').length
      totalLXCs += n.lxcs.length
      runningLXCs += n.lxcs.filter(c => c.status === 'running').length
      memUsed += n.mem || 0
      memTotal += n.maxmem || 0
      cpuSum += n.cpu || 0
    }
    const avgCPU = totalNodes > 0 ? (cpuSum / totalNodes) * 100 : null
    const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : null
    return { totalNodes, onlineNodes, totalVMs, runningVMs, totalLXCs, runningLXCs, avgCPU, memUsed, memTotal, memPct }
  }, [nodes])

  // Guest filtering & sorting
  const allTags = useMemo(() => {
    const s = new Set()
    for (const n of nodes ?? []) {
      for (const g of [...n.vms, ...n.lxcs]) for (const t of g.tags ?? []) s.add(t)
    }
    return [...s].sort()
  }, [nodes])

  const filtersActive = guestQuery.trim() !== '' || activeTag !== null || runningOnly || guestKind !== 'all'

  const matchGuest = useCallback((g, pxType) => {
    if (guestKind === 'vm' && pxType !== 'qemu') return false
    if (guestKind === 'lxc' && pxType !== 'lxc') return false
    if (runningOnly && g.status !== 'running') return false
    if (activeTag && !(g.tags ?? []).includes(activeTag)) return false
    const q = guestQuery.trim().toLowerCase()
    if (!q) return true
    const label = serviceLinks[`${pxType}:${g.vmid}`]?.label ?? ''
    return g.name.toLowerCase().includes(q) || String(g.vmid).includes(q) || label.toLowerCase().includes(q)
  }, [guestKind, guestQuery, activeTag, runningOnly, serviceLinks])

  const sortGuests = useCallback((list) => {
    const arr = [...list]
    if (guestSort === 'name') {
      return arr.sort((a, b) => {
        const na = (serviceLinks[`${a.pxType}:${a.item.vmid}`]?.label || a.item.name).toLowerCase()
        const nb = (serviceLinks[`${b.pxType}:${b.item.vmid}`]?.label || b.item.name).toLowerCase()
        return na.localeCompare(nb)
      })
    }
    if (guestSort === 'cpu') {
      return arr.sort((a, b) => {
        const ra = a.item.status === 'running' ? (a.item.cpu || 0) : -1
        const rb = b.item.status === 'running' ? (b.item.cpu || 0) : -1
        return rb - ra
      })
    }
    if (guestSort === 'mem') {
      return arr.sort((a, b) => {
        const ra = a.item.status === 'running' && a.item.maxmem ? a.item.mem / a.item.maxmem : -1
        const rb = b.item.status === 'running' && b.item.maxmem ? b.item.mem / b.item.maxmem : -1
        return rb - ra
      })
    }
    return arr.sort((a, b) => a.item.vmid - b.item.vmid)
  }, [guestSort, serviceLinks])

  const toggleTag = useCallback((t) => setActiveTag(cur => (cur === t ? null : t)), [])

  useSmoothScroll(scrollWrapperRef, scrollContentRef, {
    theme,
    enabled: view !== 'scripts',
    resetKey: view,
  })
  useViewTransition(viewRef, view, theme)
  useSlidingIndicator(navRef, navPillRef, view, theme)
  useStaggerMount(navRef, 'button')
  useScrollReveal(overviewMainRef, {
    theme,
    scrollerRef: scrollWrapperRef,
    deps: [
      view === 'dashboard',
      nodes === null,
      nodes?.length ?? 0,
      kpi.totalVMs + kpi.totalLXCs,
      activeNode,
      guestQuery,
      guestKind,
      guestSort,
      guestLayout,
      activeTag,
      runningOnly,
    ],
  })

  async function handleLogout() {
    await logout()
    onLogout()
  }

  // Metadata for unified AppHeader
  const headerMeta = {
    dashboard: {
      title: 'Node Overview',
      subtitle: activeAddr ? `Live resource usage — ${activeAddr}` : 'Live Proxmox cluster resources & services',
      localOnly: false,
    },
    hardware: {
      title: 'Hardware Health',
      subtitle: activeAddr ? `Sensors, SMART drives, and ZFS pools — ${activeAddr}` : 'Host thermal sensors, SMART drives, and ZFS pools',
      localOnly: false,
    },
    network: {
      title: 'Network',
      subtitle: 'Host interfaces, live throughput, and WAN speedtest',
      localOnly: true,
    },
    scripts: {
      title: 'Script Catalog',
      subtitle: activeAddr ? `Running on ${activeAddr}` : 'One-click community-scripts installs',
      localOnly: false,
    },
    backups: {
      title: 'Backups',
      subtitle: 'Last backup per guest, vzdump history, and Proxmox Backup Server',
      localOnly: true,
    },
    schedules: {
      title: 'Schedules',
      subtitle: 'One-time and recurring updates, backups, snapshots, and power tasks',
      localOnly: true,
    },
    activity: {
      title: 'Activity',
      subtitle: 'Dashboard jobs and the Proxmox cluster task log',
      localOnly: true,
    },
    notebook: {
      title: 'Notebook',
      subtitle: 'Markdown notes and interactive checklists pinned to your homelab',
      localOnly: true,
    },
    nodes: {
      title: 'Nodes',
      subtitle: 'Pair and manage secondary SuperDash agents',
      localOnly: false,
    },
    settings: {
      title: 'Settings',
      subtitle: 'Themes, security, notifications, backups, and integrations',
      localOnly: false,
    },
  }[view] || { title: 'Dashboard', subtitle: '', localOnly: false }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#0c0c14] text-white overflow-hidden">

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center gap-2.5 px-4 py-3 bg-[#101018] border-b border-white/[0.06] shrink-0">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          className="text-gray-400 hover:text-white p-1 -ml-1 transition-colors"
        >
          <IconMenu />
        </button>
        <ShapeMagicLogo size={24} theme={theme} label="" />
        <span className="font-bold text-sm tracking-tight"><ShinyText>SuperDash</ShinyText></span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="text-gray-400 hover:text-white p-1.5 rounded-lg bg-white/5 transition-colors"
          >
            <IconSearch size={14} />
          </button>
          <ActiveJobPill job={activeJob} onClick={openActiveJobModal} />
          <UpdateHeaderPill
            info={appUpdate}
            open={updateBannerOpen}
            onClick={() => setUpdateBannerOpen(v => !v)}
            compact
          />
          <StatusDot pulseKey={pulseKey} connected={connected} disconnected={disconnected || unreachable} />
        </span>
      </header>

      {/* Drawer backdrop (mobile) */}
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 md:static md:z-auto md:w-56 shrink-0 bg-[#101018] border-r border-white/[0.06] flex flex-col py-4 transform transition-transform duration-200 md:transform-none ${navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Brand */}
        <div className="px-4 mb-5 flex items-center gap-2.5">
          <ShapeMagicLogo size={30} theme={theme} interactive label="SuperDash" />
          <span className="font-bold text-[15px] tracking-tight flex-1">
            <ShinyText>SuperDash</ShinyText>
          </span>
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="md:hidden text-gray-500 hover:text-white p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Node selector */}
        <div className="px-3 mb-3">
          <div className="bg-[#0c0c14] border border-white/[0.07] rounded-xl p-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1 mb-1">
              Target Host
            </label>
            <select
              value={activeNode ?? ''}
              onChange={e => setActiveNode(e.target.value || null)}
              className="w-full bg-[#13131e] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
            >
              <option value="">This host (local)</option>
              {pairedNodes.map(n => (
                <option key={n.id} value={n.id}>
                  {n.node_name ? `${n.node_name} (${n.address})` : n.address}
                </option>
              ))}
            </select>
            {activeNode && (
              <p className="text-[10px] text-gray-500 px-1 mt-1.5">Applies to Dashboard, Hardware &amp; Scripts.</p>
            )}
          </div>
        </div>

        {/* Grouped Navigation (all buttons direct children of <nav> for GSAP glide pill) */}
        <nav ref={navRef} data-lenis-prevent className="relative flex-1 px-2 overflow-y-auto">
          <span
            ref={navPillRef}
            aria-hidden="true"
            className="nav-glide-pill pointer-events-none absolute left-2 right-2 top-0 rounded-xl z-0"
            style={{ opacity: 0 }}
          />

          <NavSectionLabel>Infrastructure</NavSectionLabel>
          <NavItem icon={<IconGrid />} label="Dashboard" active={view === 'dashboard'} onClick={() => go('dashboard')} badge={pendingUpdates} />
          <NavItem icon={<IconHardware />} label="Hardware" active={view === 'hardware'} onClick={() => go('hardware')} />
          <NavItem icon={<IconWifi />} label="Network" active={view === 'network'} onClick={() => go('network')} />

          <NavSectionLabel>Operations</NavSectionLabel>
          <NavItem icon={<IconTerminal />} label="Scripts" active={view === 'scripts'} onClick={() => go('scripts')} />
          <NavItem icon={<IconArchive />} label="Backups" active={view === 'backups'} onClick={() => go('backups')} />
          <NavItem icon={<IconCalendarClock />} label="Schedules" active={view === 'schedules'} onClick={() => go('schedules')} />
          <NavItem icon={<IconActivity />} label="Activity" active={view === 'activity'} onClick={() => go('activity')} />

          <NavSectionLabel>Workspace</NavSectionLabel>
          <NavItem icon={<IconNote />} label="Notebook" active={view === 'notebook'} onClick={() => go('notebook', () => setNotebookFilter(null))} />
          <NavItem icon={<IconNetwork />} label="Nodes" active={view === 'nodes'} onClick={() => go('nodes')} />
          <NavItem icon={<IconSettings />} label="Settings" active={view === 'settings'} onClick={() => go('settings')} />
        </nav>

        {/* Sidebar Footer: Quick Theme Switcher + Sign out */}
        <div className="px-2 pt-2.5 mt-2 border-t border-white/[0.06] space-y-0.5">
          <SidebarThemePicker theme={theme} setTheme={setTheme} />
          <NavItem icon={<IconLogout />} label="Sign out" onClick={handleLogout} />
        </div>
      </aside>

      {/* Main Content Pane */}
      <div ref={scrollWrapperRef} className="flex-1 overflow-y-auto">
        <div ref={scrollContentRef} className={view === 'scripts' ? 'h-full' : ''}>
          {view !== 'scripts' && (
            <ScrollProgressBar scrollerRef={scrollWrapperRef} theme={theme} resetKey={view} />
          )}
          <ScrollContainerContext.Provider value={scrollWrapperRef}>

            <UpdateBanner
              info={appUpdate}
              open={updateBannerOpen}
              onClose={() => setUpdateBannerOpen(false)}
            />

            <ErrorBoundary resetKey={view}>
              <div ref={viewRef} className={view === 'scripts' ? 'h-full flex flex-col' : ''}>

                {/* Unified Sticky Header */}
                <AppHeader
                  title={headerMeta.title}
                  subtitle={headerMeta.subtitle}
                  sticky={view !== 'scripts'}
                  theme={theme}
                  onOpenPalette={() => setPaletteOpen(true)}
                  activeJob={activeJob}
                  onOpenJob={openActiveJobModal}
                  appUpdate={appUpdate}
                  updateBannerOpen={updateBannerOpen}
                  onToggleUpdateBanner={() => setUpdateBannerOpen(v => !v)}
                  localOnly={headerMeta.localOnly}
                  activeNode={activeNode}
                  rebootRequired={view === 'dashboard' && rebootRequired}
                  liveStatus={view === 'dashboard' ? { pulseKey, connected, disconnected: disconnected || unreachable, unreachable } : null}
                />

                {view === 'network' ? (
                  <Network />
                ) : view === 'hardware' ? (
                  <Hardware node={activeNode} />
                ) : view === 'backups' ? (
                  <Backups />
                ) : view === 'schedules' ? (
                  <Schedules nodes={nodes} pairedNodes={pairedNodes} selfNode={selfNode} activeNode={activeNode} />
                ) : view === 'activity' ? (
                  <Activity />
                ) : view === 'settings' ? (
                  <Settings theme={theme} setTheme={setTheme} onDataImported={() => { refreshServiceLinks(); refreshCounts() }} />
                ) : view === 'nodes' ? (
                  <Nodes nodes={pairedNodes} onChange={refreshNodes} />
                ) : view === 'scripts' ? (
                  <Scripts node={activeNode} lxcs={entities.filter(e => e.type === 'lxc')} theme={theme} />
                ) : view === 'notebook' ? (
                  <Notebook entities={entities} filter={notebookFilter} onCountsChanged={refreshCounts} />
                ) : (
                  <main ref={overviewMainRef} className={`p-4 sm:p-8 space-y-6 max-w-[1600px] cards-region ${dimmed ? 'dimmed' : ''} ${reconnecting ? 'reconnect-pulse' : ''}`}>

                    {/* KPI Stat Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                      <StatCard
                        data-reveal=""
                        label="Nodes Online"
                        loading={nodes === null}
                        value={`${kpi.onlineNodes} / ${kpi.totalNodes}`}
                        sub={kpi.totalNodes > 0 ? (kpi.onlineNodes === kpi.totalNodes ? 'All nodes healthy' : `${kpi.totalNodes - kpi.onlineNodes} offline`) : undefined}
                        meter={kpi.totalNodes > 0 ? (kpi.onlineNodes / kpi.totalNodes) * 100 : undefined}
                        icon={<IconServer />}
                      />
                      <StatCard
                        data-reveal=""
                        label="Virtual Machines"
                        loading={nodes === null}
                        value={kpi.totalVMs}
                        sub={kpi.totalVMs > 0 ? `${kpi.runningVMs} running · ${kpi.totalVMs - kpi.runningVMs} stopped` : 'No VMs configured'}
                        meter={kpi.totalVMs > 0 ? (kpi.runningVMs / kpi.totalVMs) * 100 : undefined}
                        icon={<IconMonitor />}
                      />
                      <StatCard
                        data-reveal=""
                        label="Containers"
                        loading={nodes === null}
                        value={kpi.totalLXCs}
                        sub={kpi.totalLXCs > 0 ? `${kpi.runningLXCs} running · ${kpi.totalLXCs - kpi.runningLXCs} stopped` : 'No LXCs configured'}
                        meter={kpi.totalLXCs > 0 ? (kpi.runningLXCs / kpi.totalLXCs) * 100 : undefined}
                        icon={<IconBox />}
                      />
                      <StatCard
                        data-reveal=""
                        label="Cluster Load"
                        loading={nodes === null}
                        value={kpi.avgCPU === null ? '—' : kpi.avgCPU}
                        format={(n) => `${n.toFixed(1)}%`}
                        sub={kpi.memTotal > 0 ? `RAM ${fmtPair(kpi.memUsed, kpi.memTotal)}` : undefined}
                        meter={kpi.memPct ?? undefined}
                        icon={<IconCpu />}
                      />
                    </div>

                    {/* Node & Guest Fleet */}
                    {unreachable ? (
                      <DegradedNotice
                        title="Node unreachable"
                        detail={`Can't reach ${activeAddr || 'the node'} — the agent may be down or the network is interrupted. Retrying every 3 seconds.`}
                      />
                    ) : nodes === null ? (
                      <div className="space-y-6" aria-busy="true">
                        <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6 space-y-4">
                          <div className="skeleton h-4 w-40" />
                          <div className="skeleton h-1.5 w-full" />
                          <div className="skeleton h-1.5 w-full" />
                          <div className="skeleton h-1.5 w-full" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                          {[0, 1, 2, 3].map(i => (
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
                        {/* Upgraded Guest Toolbar: search, type filter, running toggle, sort, grid/list toggle, tags */}
                        {(kpi.totalVMs + kpi.totalLXCs) > 0 && (
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              {/* Search input */}
                              <div className="relative flex-1 min-w-[180px] max-w-xs">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                                  <IconSearch size={13} />
                                </span>
                                <input
                                  value={guestQuery}
                                  onChange={e => setGuestQuery(e.target.value)}
                                  placeholder="Filter guests…"
                                  aria-label="Filter guests by name, ID, or label"
                                  className="w-full bg-[#13131e] border border-white/[0.07] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
                                />
                                {guestQuery && (
                                  <button
                                    type="button"
                                    onClick={() => setGuestQuery('')}
                                    aria-label="Clear filter"
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 text-xs"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>

                              {/* Segmented kind filter: All / VMs / LXCs */}
                              <div className="inline-flex items-center bg-[#13131e] border border-white/[0.07] rounded-xl p-0.5 text-xs">
                                {[
                                  { id: 'all', label: `All (${kpi.totalVMs + kpi.totalLXCs})` },
                                  { id: 'vm',  label: `VMs (${kpi.totalVMs})` },
                                  { id: 'lxc', label: `LXCs (${kpi.totalLXCs})` },
                                ].map(opt => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setGuestKind(opt.id)}
                                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                                      guestKind === opt.id
                                        ? 'bg-white/10 text-white font-medium'
                                        : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>

                              {/* Running only pill toggle */}
                              <button
                                type="button"
                                onClick={() => setRunningOnly(v => !v)}
                                aria-pressed={runningOnly}
                                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors ${
                                  runningOnly
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 font-medium'
                                    : 'bg-[#13131e] border-white/[0.07] text-gray-400 hover:text-white'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${runningOnly ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                                Running only
                              </button>

                              {/* Right controls: Sort + Grid/List toggle */}
                              <div className="flex items-center gap-2 ml-auto">
                                <select
                                  value={guestSort}
                                  onChange={e => setGuestSort(e.target.value)}
                                  aria-label="Sort guests"
                                  className="bg-[#13131e] border border-white/[0.07] rounded-xl px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500/50"
                                >
                                  <option value="vmid">Sort: ID</option>
                                  <option value="name">Sort: Name</option>
                                  <option value="cpu">Sort: CPU ↓</option>
                                  <option value="mem">Sort: RAM ↓</option>
                                </select>

                                <div className="inline-flex items-center bg-[#13131e] border border-white/[0.07] rounded-xl p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setGuestLayout('grid')}
                                    aria-pressed={guestLayout === 'grid'}
                                    title="Grid view"
                                    className={`p-1.5 rounded-lg transition-colors ${
                                      guestLayout === 'grid' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                  >
                                    <IconGrid size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setGuestLayout('list')}
                                    aria-pressed={guestLayout === 'list'}
                                    title="Compact list view"
                                    className={`p-1.5 rounded-lg transition-colors ${
                                      guestLayout === 'list' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                  >
                                    <IconList size={13} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {allTags.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {allTags.map(t => (
                                  <TagPill key={t} tag={t} active={activeTag === t} onClick={() => toggleTag(t)} />
                                ))}
                                {activeTag && (
                                  <button
                                    type="button"
                                    onClick={() => setActiveTag(null)}
                                    className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5"
                                  >
                                    Clear tag
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {nodes.map(node => {
                          const combined = sortGuests([
                            ...node.vms.filter(g => matchGuest(g, 'qemu')).map(item => ({ item, type: 'VM', pxType: 'qemu', etype: 'vm' })),
                            ...node.lxcs.filter(g => matchGuest(g, 'lxc')).map(item => ({ item, type: 'CT', pxType: 'lxc', etype: 'lxc' })),
                          ])
                          const hiddenCount = node.vms.length + node.lxcs.length - combined.length
                          return (
                            <div key={node.id} className="space-y-3.5">
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

                              {combined.length > 0 && (
                                guestLayout === 'list' ? (
                                  <Card data-reveal="" className="overflow-hidden divide-y divide-white/[0.05]">
                                    {combined.map(({ item, type, pxType, etype }) => (
                                      <GuestRow
                                        key={`${type}-${item.vmid}`}
                                        item={item}
                                        type={type}
                                        nodeName={node.id}
                                        managed={node.managed !== false}
                                        backup={backupByVmid[item.vmid]}
                                        noteCount={noteCountByEntity[`${etype}:${item.vmid}`] || 0}
                                        onOpenNotes={openNotesFor}
                                        link={serviceLinks[`${pxType}:${item.vmid}`]}
                                        isInflight={!!inflight[`${pxType}:${item.vmid}`]}
                                        onAction={handleAction}
                                        onUpdate={type === 'CT' && node.managed !== false ? handleUpdate : undefined}
                                        ips={activeNode == null ? guestIPs : undefined}
                                        healthMap={activeNode == null ? healthMap : undefined}
                                        pveURL={pveURL}
                                        onInspect={handleInspectGuest}
                                      />
                                    ))}
                                  </Card>
                                ) : (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
                                    {combined.map(({ item, type, pxType, etype }) => (
                                      <GuestCard
                                        key={`${type}-${item.vmid}`}
                                        item={item}
                                        type={type}
                                        nodeName={node.id}
                                        managed={node.managed !== false}
                                        backup={backupByVmid[item.vmid]}
                                        noteCount={noteCountByEntity[`${etype}:${item.vmid}`] || 0}
                                        onOpenNotes={openNotesFor}
                                        link={serviceLinks[`${pxType}:${item.vmid}`]}
                                        onServiceLinkChange={refreshServiceLinks}
                                        isInflight={!!inflight[`${pxType}:${item.vmid}`]}
                                        onAction={handleAction}
                                        onUpdate={type === 'CT' && node.managed !== false ? handleUpdate : undefined}
                                        ips={activeNode == null ? guestIPs : undefined}
                                        healthMap={activeNode == null ? healthMap : undefined}
                                        pveURL={pveURL}
                                        onInspect={handleInspectGuest}
                                        onTagClick={toggleTag}
                                        activeTag={activeTag}
                                      />
                                    ))}
                                  </div>
                                )
                              )}

                              {filtersActive && hiddenCount > 0 && (
                                <p className="text-xs text-gray-500 px-1">
                                  {hiddenCount} guest{hiddenCount !== 1 ? 's' : ''} hidden by filters.
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Updates */}
                    {!unreachable && (
                      <div className="space-y-6">
                        <div data-reveal="">
                          <Updates node={activeNode} />
                        </div>
                        {(() => {
                          const targetName = activeNode == null ? selfNode : activePaired?.node_name
                          const targetNode = (nodes ?? []).find(n => n.id === targetName) || (nodes?.length === 1 ? nodes[0] : null)
                          const targetLxcs = targetNode?.lxcs ?? []
                          return targetLxcs.length > 0 ? (
                            <div data-reveal="">
                              <LXCBatchUpdate lxcs={targetLxcs} node={activeNode} />
                            </div>
                          ) : null
                        })()}
                      </div>
                    )}

                  </main>
                )}

              </div>
            </ErrorBoundary>
          </ScrollContainerContext.Provider>
        </div>
      </div>

      {/* Slide-over Guest Inspector Drawer */}
      {inspectedGuest && (
        <GuestDrawer
          guest={inspectedGuest}
          onClose={() => setInspectedRef(null)}
          backup={backupByVmid[inspectedGuest.item.vmid]}
          noteCount={noteCountByEntity[`${inspectedGuest.type === 'VM' ? 'vm' : 'lxc'}:${inspectedGuest.item.vmid}`] || 0}
          onOpenNotes={openNotesFor}
          link={serviceLinks[`${inspectedGuest.type === 'VM' ? 'qemu' : 'lxc'}:${inspectedGuest.item.vmid}`]}
          onServiceLinkChange={refreshServiceLinks}
          isInflight={!!inflight[`${inspectedGuest.type === 'VM' ? 'qemu' : 'lxc'}:${inspectedGuest.item.vmid}`]}
          onAction={handleAction}
          onUpdate={inspectedGuest.type === 'CT' && inspectedGuest.managed ? handleUpdate : undefined}
          ips={activeNode == null ? guestIPs : undefined}
          healthMap={activeNode == null ? healthMap : undefined}
          pveURL={pveURL}
          canInspect={activeNode == null}
          onTagClick={toggleTag}
        />
      )}

      {/* Command Palette (Cmd+K / Ctrl+K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        nodes={nodes}
        serviceLinks={serviceLinks}
        pveURL={pveURL}
        theme={theme}
        setTheme={setTheme}
        onNavigate={(v) => go(v)}
        onInspectGuest={(g) => { go('dashboard'); handleInspectGuest(g) }}
        onToggleRunning={() => setRunningOnly(v => !v)}
        onToggleLayout={() => setGuestLayout(l => (l === 'grid' ? 'list' : 'grid'))}
        guestLayout={guestLayout}
        runningOnly={runningOnly}
        onLogout={handleLogout}
      />

      {/* Confirmation modal */}
      {confirm && (
        <ConfirmModal
          confirm={confirm}
          onConfirm={() => { const c = confirm; setConfirm(null); c.action === 'update' ? runUpdate(c) : executeAction(c) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Live job log modal */}
      {updateJob && (
        <JobModal
          jobId={updateJob.jobId}
          node={updateJob.node ?? null}
          title={updateJob.title}
          onClose={() => setUpdateJob(null)}
        />
      )}

      {/* Section-transition static blip (terminal theme only) */}
      {theme === 'terminal' && blip > 0 && <div key={blip} className="crt-static run" />}

      {/* Error toast */}
      {toast && <ErrorToast message={toast} theme={theme} />}
    </div>
  )
}
