import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getSchedules, createSchedule, updateSchedule, deleteSchedule,
  runScheduleNow, previewSchedule, getBackupStorages, getNodeResources,
} from '../lib/api'
import { useJobStream } from '../hooks/useJobStream'
import { useFocusTrap } from '../lib/a11y'
import Terminal from './Terminal'
import { Card, StatCard, StatusPill } from './Card'
import { loadingText } from '../lib/copy'

const ACTIONS = [
  {
    id: 'host_update',
    label: 'Host OS Update',
    short: 'Host Update',
    group: 'updates',
    desc: 'apt-get update && upgrade on host',
    defaultTarget: 'node',
    allowPaired: true,
  },
  {
    id: 'ct_update',
    label: 'LXC Container Update',
    short: 'LXC Update',
    group: 'updates',
    desc: 'Package upgrade inside one LXC (apt/apk/dnf)',
    defaultTarget: 'lxc',
    allowPaired: true,
  },
  {
    id: 'lxc_batch_update',
    label: 'Batch LXC Update',
    short: 'Batch LXCs',
    group: 'updates',
    desc: 'Sequentially upgrade all running LXCs on a node',
    defaultTarget: 'all_lxc',
    allowPaired: true,
  },
  {
    id: 'backup',
    label: 'Backup (vzdump)',
    short: 'Backup',
    group: 'backups',
    desc: 'Proxmox vzdump for a VM, CT, or all guests',
    defaultTarget: 'lxc',
    allowPaired: false,
  },
  {
    id: 'snapshot',
    label: 'Snapshot',
    short: 'Snapshot',
    group: 'backups',
    desc: 'Point-in-time Proxmox snapshot for a VM or CT',
    defaultTarget: 'lxc',
    allowPaired: false,
  },
  {
    id: 'power',
    label: 'Power / Lifecycle',
    short: 'Power',
    group: 'other',
    desc: 'Start, shutdown, stop, reboot, or Wake-on-LAN',
    defaultTarget: 'lxc',
    allowPaired: false,
  },
  {
    id: 'speedtest',
    label: 'Network Speedtest',
    short: 'Speedtest',
    group: 'other',
    desc: 'Run speedtest-cli and record to Network history',
    defaultTarget: 'node',
    allowPaired: false,
  },
]

const ACTION_MAP = Object.fromEntries(ACTIONS.map(a => [a.id, a]))

const FREQUENCIES = [
  { id: 'once', label: 'One-time' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'cron', label: 'Cron' },
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function statusVariant(status) {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'skipped' || status === 'missed') return 'warning'
  return 'neutral'
}

function fmtRelative(iso, nowMs) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Math.round((t - nowMs) / 1000)
  const abs = Math.abs(diff)
  const past = diff < 0
  let s
  if (abs < 60) s = '<1m'
  else if (abs < 3600) s = `${Math.round(abs / 60)}m`
  else if (abs < 86400) {
    const h = Math.floor(abs / 3600)
    const m = Math.round((abs % 3600) / 60)
    s = m > 0 ? `${h}h ${m}m` : `${h}h`
  } else {
    const d = Math.floor(abs / 86400)
    const h = Math.round((abs % 86400) / 3600)
    s = h > 0 ? `${d}d ${h}h` : `${d}d`
  }
  return past ? `${s} ago` : `in ${s}`
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function defaultRunAtLocal() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isoToDatetimeLocal(iso) {
  if (!iso) return defaultRunAtLocal()
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return defaultRunAtLocal()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function describeFrequency(s) {
  switch (s.frequency) {
    case 'once':
      return `Once · ${fmtDateTime(s.run_at)}`
    case 'hourly':
      return `Hourly · :${String(s.minute ?? 0).padStart(2, '0')}`
    case 'daily':
      return `Daily · ${s.time_of_day || '00:00'}`
    case 'weekly': {
      const days = (s.days_of_week ?? []).map(d => WEEKDAYS[d]).filter(Boolean).join(', ')
      return `Weekly · ${days || '—'} at ${s.time_of_day || '00:00'}`
    }
    case 'monthly':
      return `Monthly · Day ${s.day_of_month || 1} at ${s.time_of_day || '00:00'}`
    case 'cron':
      return `Cron · ${s.cron_expr}`
    default:
      return s.frequency
  }
}

function describeTarget(s, pairedNodes) {
  const paired = s.paired_node_id
    ? pairedNodes.find(n => n.id === s.paired_node_id)
    : null
  const nodeLabel = paired
    ? (paired.node_name || paired.address)
    : (s.node || 'local')

  if (s.target_type === 'lxc') {
    return `${nodeLabel} · CT ${s.vmid}${s.guest_name ? ` (${s.guest_name})` : ''}`
  }
  if (s.target_type === 'qemu') {
    return `${nodeLabel} · VM ${s.vmid}${s.guest_name ? ` (${s.guest_name})` : ''}`
  }
  if (s.target_type === 'all_lxc') {
    return `${nodeLabel} · All running LXCs`
  }
  if (s.target_type === 'all_guests') {
    return `${nodeLabel} · All guests`
  }
  return nodeLabel
}

function describeOptions(s) {
  const o = s.options || {}
  if (s.action === 'power' && o.power_action) return o.power_action
  if (s.action === 'backup') {
    const bits = [o.storage || 'default storage', o.mode || 'snapshot', o.compress || 'zstd']
    return bits.join(' · ')
  }
  if (s.action === 'snapshot') {
    return `${o.snapshot_name || 'simpdash'}-…${o.include_ram ? ' (+RAM)' : ''}`
  }
  if (s.action === 'lxc_batch_update') {
    const excl = o.exclude?.length ? `${o.exclude.length} excluded` : 'default excludes'
    return o.continue_on_error === false ? `${excl} · stop on error` : excl
  }
  return ''
}

// --- small icons ---
function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>
    </svg>
  )
}
function IconCheckCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  )
}
function IconPlay() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="6 4 20 12 6 20 6 4"/>
    </svg>
  )
}
function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>
    </svg>
  )
}
function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  )
}
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}
function IconServerSm() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/>
      <line x1="6" y1="6.5" x2="6.01" y2="6.5"/><line x1="6" y1="17.5" x2="6.01" y2="17.5"/>
    </svg>
  )
}

// JobLogModal streams a live or finished scheduled job's output.
function JobLogModal({ jobId, title, onClose }) {
  const { output, state } = useJobStream(jobId, null)
  const trap = useFocusTrap()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-white truncate">{title}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {state === 'running' && <StatusPill variant="neutral">Running…</StatusPill>}
            {state === 'succeeded' && <StatusPill variant="success">Succeeded</StatusPill>}
            {state === 'failed' && <StatusPill variant="error">Failed</StatusPill>}
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-sm">✕</button>
          </div>
        </div>
        <Terminal output={output} state={state} />
      </div>
    </div>
  )
}

// ScheduleModal — Create or Edit a scheduled task.
function ScheduleModal({ initial, clusterNodes, pairedNodes, selfNode, timezone, onClose, onSaved }) {
  const trap = useFocusTrap()
  const isEdit = Boolean(initial?.id)

  const defaultNodeName = initial?.node || selfNode || clusterNodes[0]?.id || ''

  const [name, setName] = useState(initial?.name || '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [action, setAction] = useState(initial?.action || 'lxc_batch_update')

  // Node selector encodes either "local:<nodeName>" or "paired:<pairedId>"
  const [nodeKey, setNodeKey] = useState(() => {
    if (initial?.paired_node_id) return `paired:${initial.paired_node_id}`
    return `local:${defaultNodeName}`
  })
  const [targetType, setTargetType] = useState(initial?.target_type || 'all_lxc')
  const [vmid, setVmid] = useState(initial?.vmid ? String(initial.vmid) : '')

  // Action options
  const [powerAction, setPowerAction] = useState(initial?.options?.power_action || 'reboot')
  const [storage, setStorage] = useState(initial?.options?.storage || '')
  const [backupMode, setBackupMode] = useState(initial?.options?.mode || 'snapshot')
  const [compress, setCompress] = useState(initial?.options?.compress || 'zstd')
  const [backupNotes, setBackupNotes] = useState(initial?.options?.notes || '')
  const [snapPrefix, setSnapPrefix] = useState(initial?.options?.snapshot_name || 'simpdash')
  const [includeRAM, setIncludeRAM] = useState(Boolean(initial?.options?.include_ram))
  const [continueOnError, setContinueOnError] = useState(initial?.options?.continue_on_error !== false)
  const [customExcludes, setCustomExcludes] = useState(() => initial?.options?.exclude ?? null) // null = use global excludes

  // Timing
  const [frequency, setFrequency] = useState(initial?.frequency || 'weekly')
  const [runAt, setRunAt] = useState(() => isoToDatetimeLocal(initial?.run_at))
  const [timeOfDay, setTimeOfDay] = useState(initial?.time_of_day || '03:00')
  const [minute, setMinute] = useState(initial?.minute ?? 0)
  const [daysOfWeek, setDaysOfWeek] = useState(initial?.days_of_week?.length ? initial.days_of_week : [0])
  const [dayOfMonth, setDayOfMonth] = useState(initial?.day_of_month || 1)
  const [cronExpr, setCronExpr] = useState(initial?.cron_expr || '0 3 * * 0')

  // Policy
  const [ifBusy, setIfBusy] = useState(initial?.if_busy || 'queue')
  const [notify, setNotify] = useState(initial?.notify || 'failure')

  // Dynamic lookups (storages, paired node guests, preview)
  const [storages, setStorages] = useState([])
  const [pairedResources, setPairedResources] = useState(null)
  const [preview, setPreview] = useState({ runs: [], error: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isPaired = nodeKey.startsWith('paired:')
  const pairedId = isPaired ? nodeKey.slice('paired:'.length) : ''
  const selectedNodeName = isPaired
    ? (pairedNodes.find(n => n.id === pairedId)?.node_name || '')
    : nodeKey.slice('local:'.length)

  const actionMeta = ACTION_MAP[action] || ACTIONS[0]

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch paired node's guests when a paired secondary is selected.
  useEffect(() => {
    if (!isPaired || !pairedId) {
      setPairedResources(null)
      return
    }
    let live = true
    getNodeResources(pairedId)
      .then(snap => { if (live) setPairedResources(snap?.nodes ?? []) })
      .catch(() => { if (live) setPairedResources([]) })
    return () => { live = false }
  }, [isPaired, pairedId])

  // Fetch Proxmox backup storages for the chosen node when action === 'backup'.
  useEffect(() => {
    if (action !== 'backup' || isPaired) return
    let live = true
    getBackupStorages(selectedNodeName)
      .then(d => { if (live) setStorages(d.storages ?? []) })
      .catch(() => { if (live) setStorages([]) })
    return () => { live = false }
  }, [action, isPaired, selectedNodeName])

  // Available guests on the currently selected node.
  const nodeGuests = useMemo(() => {
    const src = isPaired ? (pairedResources ?? []) : clusterNodes
    const nodeObj = isPaired
      ? src[0]
      : (src.find(n => n.id === selectedNodeName) || src[0])
    return {
      lxcs: [...(nodeObj?.lxcs ?? [])].sort((a, b) => a.vmid - b.vmid),
      vms: [...(nodeObj?.vms ?? [])].sort((a, b) => a.vmid - b.vmid),
    }
  }, [isPaired, pairedResources, clusterNodes, selectedNodeName])

  // Keep targetType and nodeKey valid when the user switches Action.
  function selectAction(nextAction) {
    setAction(nextAction)
    const meta = ACTION_MAP[nextAction]
    if (!meta) return
    if (!meta.allowPaired && isPaired) {
      setNodeKey(`local:${selfNode || clusterNodes[0]?.id || ''}`)
    }
    if (nextAction === 'host_update' || nextAction === 'speedtest') {
      setTargetType('node')
      setVmid('')
    } else if (nextAction === 'lxc_batch_update') {
      setTargetType('all_lxc')
      setVmid('')
    } else if (nextAction === 'ct_update') {
      setTargetType('lxc')
    } else if (nextAction === 'backup') {
      if (!['lxc', 'qemu', 'all_guests'].includes(targetType)) setTargetType('lxc')
    } else if (nextAction === 'snapshot') {
      if (!['lxc', 'qemu'].includes(targetType)) setTargetType('lxc')
    } else if (nextAction === 'power') {
      if (!['node', 'lxc', 'qemu'].includes(targetType)) setTargetType('lxc')
    }
  }

  // Keep powerAction valid when switching between node & guest targets.
  useEffect(() => {
    if (action !== 'power') return
    if (targetType === 'node' && !['reboot', 'shutdown', 'wake'].includes(powerAction)) {
      setPowerAction('reboot')
    } else if (targetType !== 'node' && !['start', 'shutdown', 'stop', 'reboot'].includes(powerAction)) {
      setPowerAction('reboot')
    }
  }, [action, targetType, powerAction])

  // Auto-select first matching guest when switching targetType/node if current vmid isn't valid.
  useEffect(() => {
    if (targetType !== 'lxc' && targetType !== 'qemu') return
    const list = targetType === 'lxc' ? nodeGuests.lxcs : nodeGuests.vms
    if (list.length === 0) return
    if (!list.some(g => String(g.vmid) === String(vmid))) {
      setVmid(String(list[0].vmid))
    }
  }, [targetType, nodeGuests, vmid])

  // Live preview of next 3 runs from the backend.
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      const timing = {
        frequency,
        run_at: frequency === 'once' ? runAt : '',
        time_of_day: timeOfDay,
        minute: Number(minute) || 0,
        days_of_week: daysOfWeek,
        day_of_month: Number(dayOfMonth) || 1,
        cron_expr: cronExpr,
      }
      previewSchedule(timing)
        .then(res => { if (live) setPreview({ runs: res.next_runs ?? [], error: '' }) })
        .catch(e => { if (live) setPreview({ runs: [], error: e.message }) })
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [frequency, runAt, timeOfDay, minute, daysOfWeek, dayOfMonth, cronExpr])

  function toggleDay(d) {
    setDaysOfWeek(prev => {
      if (prev.includes(d)) {
        return prev.length > 1 ? prev.filter(x => x !== d) : prev
      }
      return [...prev, d].sort((a, b) => a - b)
    })
  }

  function toggleExcludeVmid(id) {
    setCustomExcludes(prev => {
      const base = prev ?? []
      return base.includes(id) ? base.filter(x => x !== id) : [...base, id].sort((a, b) => a - b)
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const guestList = targetType === 'lxc' ? nodeGuests.lxcs : targetType === 'qemu' ? nodeGuests.vms : []
    const chosenGuest = guestList.find(g => String(g.vmid) === String(vmid))

    const options = {}
    if (action === 'power') {
      options.power_action = powerAction
    } else if (action === 'backup') {
      if (storage) options.storage = storage
      options.mode = backupMode
      options.compress = compress
      if (backupNotes.trim()) options.notes = backupNotes.trim()
    } else if (action === 'snapshot') {
      options.snapshot_name = snapPrefix.trim() || 'simpdash'
      if (targetType === 'qemu') options.include_ram = includeRAM
    } else if (action === 'lxc_batch_update') {
      options.continue_on_error = continueOnError
      if (customExcludes !== null) options.exclude = customExcludes
    }

    const autoName = name.trim() || `${actionMeta.short}${chosenGuest ? ` · ${chosenGuest.name}` : selectedNodeName ? ` · ${selectedNodeName}` : ''}`

    const payload = {
      name: autoName,
      enabled,
      action,
      target_type: targetType,
      node: selectedNodeName,
      paired_node_id: pairedId,
      vmid: (targetType === 'lxc' || targetType === 'qemu') ? Number(vmid) : 0,
      guest_name: chosenGuest?.name || '',
      options,
      frequency,
      run_at: frequency === 'once' ? runAt : '',
      time_of_day: timeOfDay,
      minute: Number(minute) || 0,
      days_of_week: daysOfWeek,
      day_of_month: Number(dayOfMonth) || 1,
      cron_expr: cronExpr,
      if_busy: ifBusy,
      notify,
    }

    setSaving(true)
    try {
      if (isEdit) {
        await updateSchedule(initial.id, payload)
      } else {
        await createSchedule(payload)
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  const targetChoices = useMemo(() => {
    switch (action) {
      case 'host_update':
      case 'speedtest':
        return [{ id: 'node', label: 'Node' }]
      case 'ct_update':
        return [{ id: 'lxc', label: 'Container (LXC)' }]
      case 'lxc_batch_update':
        return [{ id: 'all_lxc', label: 'All running LXCs on node' }]
      case 'backup':
        return [
          { id: 'lxc', label: 'Container (LXC)' },
          { id: 'qemu', label: 'Virtual Machine' },
          { id: 'all_guests', label: 'All guests on node' },
        ]
      case 'snapshot':
        return [
          { id: 'lxc', label: 'Container (LXC)' },
          { id: 'qemu', label: 'Virtual Machine' },
        ]
      case 'power':
        return [
          { id: 'lxc', label: 'Container (LXC)' },
          { id: 'qemu', label: 'Virtual Machine' },
          { id: 'node', label: 'Node' },
        ]
      default:
        return []
    }
  }, [action])

  const inputCls = 'w-full bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500/50 placeholder:text-gray-600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit schedule' : 'New schedule'}
        className="bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">
              {isEdit ? 'Edit Schedule' : 'New Scheduled Task'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pick what to run, where to run it, and how often.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-sm p-1">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 space-y-5">
          {/* 1. Name & Enabled */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Schedule Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Sunday 3 AM LXC Updates"
                maxLength={120}
                className={inputCls}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none pb-2.5 shrink-0">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
                className="accent-blue-500 w-4 h-4"
              />
              Enabled
            </label>
          </div>

          {/* 2. Service / Action Type */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-2">Service / Action</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ACTIONS.map(a => {
                const active = action === a.id
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => selectAction(a.id)}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      active
                        ? 'bg-blue-500/15 border-blue-500/40 text-white'
                        : 'bg-[#0c0c14] border-white/[0.07] text-gray-300 hover:border-white/20'
                    }`}
                  >
                    <div className="text-xs font-semibold">{a.label}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{a.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. Target (Node + Scope + Guest) */}
          <div className="space-y-3 bg-[#0c0c14]/70 border border-white/[0.06] rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-500">Target</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Node picker */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Node</label>
                <select
                  value={nodeKey}
                  onChange={e => setNodeKey(e.target.value)}
                  disabled={action === 'speedtest'}
                  className={inputCls}
                >
                  {clusterNodes.length > 0 ? (
                    <optgroup label="Proxmox Cluster">
                      {clusterNodes.map(n => (
                        <option key={`local:${n.id}`} value={`local:${n.id}`}>
                          {n.id}{n.id === selfNode ? ' (this host)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <option value={`local:${selfNode || ''}`}>{selfNode || 'This host (local)'}</option>
                  )}
                  {actionMeta.allowPaired && pairedNodes.length > 0 && (
                    <optgroup label="Paired Secondary Agents">
                      {pairedNodes.map(p => (
                        <option key={`paired:${p.id}`} value={`paired:${p.id}`}>
                          {p.node_name ? `${p.node_name} (${p.address})` : p.address}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {action === 'ct_update' || action === 'lxc_batch_update' || action === 'host_update' ? (
                  !isPaired && selectedNodeName && selfNode && selectedNodeName !== selfNode && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      OS/LXC updates run via the host agent — pick this host or a paired secondary.
                    </p>
                  )
                ) : null}
              </div>

              {/* Scope / Target type */}
              {targetChoices.length > 1 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Scope</label>
                  <select
                    value={targetType}
                    onChange={e => setTargetType(e.target.value)}
                    className={inputCls}
                  >
                    {targetChoices.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Specific Guest picker */}
              {(targetType === 'lxc' || targetType === 'qemu') && (
                <div className={targetChoices.length > 1 ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs text-gray-400 mb-1">
                    {targetType === 'lxc' ? 'Container (LXC)' : 'Virtual Machine (QEMU)'}
                  </label>
                  {(targetType === 'lxc' ? nodeGuests.lxcs : nodeGuests.vms).length > 0 ? (
                    <select
                      value={vmid}
                      onChange={e => setVmid(e.target.value)}
                      className={inputCls}
                    >
                      {(targetType === 'lxc' ? nodeGuests.lxcs : nodeGuests.vms).map(g => (
                        <option key={g.vmid} value={g.vmid}>
                          {targetType === 'lxc' ? 'CT' : 'VM'} {g.vmid} · {g.name} ({g.status})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min="1"
                      value={vmid}
                      onChange={e => setVmid(e.target.value)}
                      placeholder="Enter VMID (e.g. 101)"
                      className={inputCls}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Action-specific options */}
            {action === 'backup' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/[0.06]">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Backup Storage</label>
                  {storages.length > 0 ? (
                    <select value={storage} onChange={e => setStorage(e.target.value)} className={inputCls}>
                      <option value="">Default storage</option>
                      {storages.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={storage}
                      onChange={e => setStorage(e.target.value)}
                      placeholder="Default (or e.g. local)"
                      className={inputCls}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Mode</label>
                  <select value={backupMode} onChange={e => setBackupMode(e.target.value)} className={inputCls}>
                    <option value="snapshot">Snapshot (live)</option>
                    <option value="suspend">Suspend</option>
                    <option value="stop">Stop (cold)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Compression</label>
                  <select value={compress} onChange={e => setCompress(e.target.value)} className={inputCls}>
                    <option value="zstd">zstd (recommended)</option>
                    <option value="gzip">gzip</option>
                    <option value="lzo">lzo</option>
                    <option value="0">None</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={backupNotes}
                    onChange={e => setBackupNotes(e.target.value)}
                    placeholder="e.g. Scheduled by SuperDash ({{guestname}})"
                    className={inputCls}
                  />
                </div>
              </div>
            )}

            {action === 'snapshot' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06] items-end">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Snapshot Name Prefix</label>
                  <input
                    type="text"
                    value={snapPrefix}
                    onChange={e => setSnapPrefix(e.target.value)}
                    placeholder="simpdash"
                    className={inputCls}
                  />
                  <p className="text-[11px] text-gray-600 mt-1">Timestamp is appended automatically.</p>
                </div>
                {targetType === 'qemu' && (
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pb-6">
                    <input
                      type="checkbox"
                      checked={includeRAM}
                      onChange={e => setIncludeRAM(e.target.checked)}
                      className="accent-blue-500"
                    />
                    Include VM RAM state (vmstate)
                  </label>
                )}
              </div>
            )}

            {action === 'power' && (
              <div className="pt-2 border-t border-white/[0.06]">
                <label className="block text-xs text-gray-400 mb-1.5">Power Action</label>
                <div className="flex flex-wrap gap-2">
                  {(targetType === 'node'
                    ? [
                        { id: 'reboot', label: 'Reboot' },
                        { id: 'shutdown', label: 'Shutdown' },
                        { id: 'wake', label: 'Wake-on-LAN' },
                      ]
                    : [
                        { id: 'start', label: 'Start' },
                        { id: 'shutdown', label: 'Graceful Shutdown' },
                        { id: 'reboot', label: 'Reboot' },
                        { id: 'stop', label: 'Force Stop' },
                      ]
                  ).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPowerAction(opt.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        powerAction === opt.id
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                          : 'bg-[#0c0c14] border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {action === 'lxc_batch_update' && (
              <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={continueOnError}
                      onChange={e => setContinueOnError(e.target.checked)}
                      className="accent-blue-500"
                    />
                    Continue remaining containers if one fails
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customExcludes !== null}
                      onChange={e => setCustomExcludes(e.target.checked ? [] : null)}
                      className="accent-blue-500"
                    />
                    Override default exclude list
                  </label>
                </div>
                {customExcludes !== null && nodeGuests.lxcs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {nodeGuests.lxcs.map(ct => {
                      const excluded = customExcludes.includes(ct.vmid)
                      return (
                        <button
                          key={ct.vmid}
                          type="button"
                          onClick={() => toggleExcludeVmid(ct.vmid)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                            excluded
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 line-through'
                              : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/25'
                          }`}
                        >
                          CT {ct.vmid} · {ct.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. Frequency & Timing */}
          <div className="space-y-3 bg-[#0c0c14]/70 border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-gray-500">Schedule</span>
              {timezone && <span className="text-[11px] text-gray-500">Server TZ: {timezone}</span>}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {FREQUENCIES.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFrequency(f.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    frequency === f.id
                      ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                      : 'bg-[#13131e] border-white/10 text-gray-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {frequency === 'once' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Run date &amp; time</label>
                <input
                  type="datetime-local"
                  value={runAt}
                  onChange={e => setRunAt(e.target.value)}
                  className={inputCls}
                />
              </div>
            )}

            {frequency === 'hourly' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Minute past the hour (0–59)</label>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minute}
                  onChange={e => setMinute(e.target.value)}
                  className={`${inputCls} max-w-[140px]`}
                />
              </div>
            )}

            {frequency === 'daily' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Time of day</label>
                <input
                  type="time"
                  value={timeOfDay}
                  onChange={e => setTimeOfDay(e.target.value)}
                  className={`${inputCls} max-w-[160px]`}
                />
              </div>
            )}

            {frequency === 'weekly' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Days of week</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((label, idx) => {
                      const on = daysOfWeek.includes(idx)
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => toggleDay(idx)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            on
                              ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                              : 'bg-[#13131e] border-white/10 text-gray-500 hover:text-gray-200'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Time of day</label>
                  <input
                    type="time"
                    value={timeOfDay}
                    onChange={e => setTimeOfDay(e.target.value)}
                    className={`${inputCls} max-w-[160px]`}
                  />
                </div>
              </div>
            )}

            {frequency === 'monthly' && (
              <div className="grid grid-cols-2 gap-3 max-w-xs">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Day of month (1–31)</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dayOfMonth}
                    onChange={e => setDayOfMonth(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Time of day</label>
                  <input
                    type="time"
                    value={timeOfDay}
                    onChange={e => setTimeOfDay(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            )}

            {frequency === 'cron' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">5-field Cron Expression</label>
                <input
                  type="text"
                  value={cronExpr}
                  onChange={e => setCronExpr(e.target.value)}
                  placeholder="0 3 * * 0"
                  className={`${inputCls} font-mono`}
                />
                <p className="text-[11px] text-gray-600 mt-1">
                  Format: <code className="text-gray-400">minute hour day-of-month month day-of-week</code> (e.g. <code className="text-gray-400">30 2 * * 1,4</code>)
                </p>
              </div>
            )}

            {/* Next 3 runs preview */}
            <div className="pt-2 border-t border-white/[0.06] text-xs">
              {preview.error ? (
                <p className="text-red-400">{preview.error}</p>
              ) : preview.runs.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-400">
                  <span className="text-gray-500">Upcoming:</span>
                  {preview.runs.map((iso, idx) => (
                    <span key={iso} className="font-mono text-[11px] text-gray-300">
                      {idx > 0 ? '· ' : ''}{fmtDateTime(iso)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-amber-400">Selected time is in the past.</p>
              )}
            </div>
          </div>

          {/* 5. Execution & Notification Policy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">If another job is running</label>
              <select value={ifBusy} onChange={e => setIfBusy(e.target.value)} className={inputCls}>
                <option value="queue">Queue and run next</option>
                <option value="skip">Skip this run</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notifications</label>
              <select value={notify} onChange={e => setNotify(e.target.value)} className={inputCls}>
                <option value="failure">Notify on failure</option>
                <option value="always">Notify on success &amp; failure</option>
                <option value="never">Do not notify</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-xs font-medium px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-200 hover:bg-blue-500/30 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Schedules({ nodes = null, pairedNodes = [], selfNode = '', activeNode = null }) {
  const loadingMsg = useMemo(() => loadingText('Loading schedules…'), [])
  const [data, setData] = useState(null)
  const [localClusterNodes, setLocalClusterNodes] = useState(null)
  const [filter, setFilter] = useState('all') // all | updates | backups | other
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [logModal, setLogModal] = useState(null)
  const [toast, setToast] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(cur => (cur === msg ? '' : cur)), 3500)
  }, [])

  const load = useCallback(() => {
    getSchedules()
      .then(setData)
      .catch(e => {
        setData(prev => prev ?? { schedules: [], native_backups: [], timezone: '', queue_len: 0 })
        showToast(e.message || 'Could not load schedules')
      })
  }, [showToast])

  useEffect(() => {
    load()
    const poll = setInterval(load, 10000)
    const tick = setInterval(() => setNowMs(Date.now()), 30000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  // If the sidebar Viewing selector is pointed at a secondary node, fetch the
  // local cluster's nodes once so the schedule builder always has the full local cluster.
  useEffect(() => {
    if (activeNode == null) {
      setLocalClusterNodes(null)
      return
    }
    let live = true
    getNodeResources(null)
      .then(snap => { if (live) setLocalClusterNodes(snap?.nodes ?? []) })
      .catch(() => { if (live) setLocalClusterNodes([]) })
    return () => { live = false }
  }, [activeNode])

  const clusterNodes = useMemo(() => {
    if (activeNode != null && localClusterNodes) return localClusterNodes
    return nodes ?? []
  }, [activeNode, localClusterNodes, nodes])

  const schedules = data?.schedules ?? []
  const nativeBackups = data?.native_backups ?? []

  const filtered = useMemo(() => {
    if (filter === 'all') return schedules
    return schedules.filter(s => (ACTION_MAP[s.action]?.group || 'other') === filter)
  }, [schedules, filter])

  const stats = useMemo(() => {
    const enabled = schedules.filter(s => s.enabled)
    const upcoming = enabled
      .filter(s => s.next_run_at)
      .sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at))[0]
    const succeeded = schedules.filter(s => s.last_status === 'succeeded').length
    const failed = schedules.filter(s => s.last_status === 'failed').length
    return { activeCount: enabled.length, totalCount: schedules.length, upcoming, succeeded, failed }
  }, [schedules])

  async function toggleEnabled(s) {
    setBusyId(s.id)
    try {
      await updateSchedule(s.id, { enabled: !s.enabled })
      load()
    } catch (e) {
      showToast(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleRunNow(s) {
    setBusyId(s.id)
    try {
      await runScheduleNow(s.id)
      load()
    } catch (e) {
      showToast(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id) {
    setBusyId(id)
    try {
      await deleteSchedule(id)
      setConfirmDelete(null)
      load()
    } catch (e) {
      showToast(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (data === null) {
    return <div className="p-4 sm:p-8 text-sm text-gray-600">{loadingMsg}</div>
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-6xl">
      {/* Stat summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Active Schedules"
          value={`${stats.activeCount} / ${stats.totalCount}`}
          sub={data.queue_len > 0 ? `${data.queue_len} queued right now` : 'No jobs waiting in queue'}
          icon={<IconClock />}
        />
        <StatCard
          label="Next Run"
          value={stats.upcoming ? fmtRelative(stats.upcoming.next_run_at, nowMs) : 'None'}
          sub={stats.upcoming ? `${stats.upcoming.name} · ${fmtDateTime(stats.upcoming.next_run_at)}` : 'Create a schedule to begin'}
          icon={<IconClock />}
        />
        <StatCard
          label="Last Outcomes"
          value={`${stats.succeeded} ok`}
          sub={stats.failed > 0 ? `${stats.failed} failed recently` : 'No failed schedules'}
          icon={<IconCheckCircle />}
        />
        <StatCard
          label="Server Timezone"
          value={data.tz_abbr || data.timezone || 'Local'}
          sub={data.server_time ? fmtDateTime(data.server_time) : ''}
          icon={<IconServerSm />}
        />
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'all', label: `All (${schedules.length})` },
            { id: 'updates', label: 'Updates' },
            { id: 'backups', label: 'Backups & Snapshots' },
            { id: 'other', label: 'Power & Other' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filter === tab.id
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-[#13131e] border-white/[0.07] text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => { setEditing(null); setModalOpen(true) }}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-200 hover:bg-blue-500/30 transition-colors"
        >
          <IconPlus />
          New Schedule
        </button>
      </div>

      {/* Schedules list */}
      <Card>
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-sm text-gray-400">
              {schedules.length === 0
                ? 'No scheduled tasks yet.'
                : 'No schedules match this filter.'}
            </p>
            <p className="text-xs text-gray-600 max-w-md mx-auto">
              Automate one-time or recurring host updates, LXC container upgrades, Proxmox backups, snapshots, power actions, and speedtests.
            </p>
            {schedules.length === 0 && (
              <button
                onClick={() => { setEditing(null); setModalOpen(true) }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-200 hover:bg-blue-500/30 transition-colors"
              >
                <IconPlus />
                Create your first schedule
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {filtered.map(s => {
              const meta = ACTION_MAP[s.action]
              const optSummary = describeOptions(s)
              const isBusy = busyId === s.id
              const isRunning = s.last_status === 'running' || s.last_status === 'queued'
              return (
                <div
                  key={s.id}
                  className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3 hover:bg-white/[0.02] transition-colors ${!s.enabled ? 'opacity-65' : ''}`}
                >
                  {/* Toggle + Title + Badges */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      disabled={isBusy}
                      onClick={() => toggleEnabled(s)}
                      title={s.enabled ? 'Disable schedule' : 'Enable schedule'}
                      className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
                        s.enabled
                          ? 'bg-blue-500/40 border-blue-400/50'
                          : 'bg-white/5 border-white/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform mt-0.5 ${
                          s.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">{s.name}</span>
                        <StatusPill variant="neutral">{meta?.short || s.action}</StatusPill>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.05] text-gray-300 font-mono">
                          {describeTarget(s, pairedNodes)}
                        </span>
                      </div>
                      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-gray-500">
                        <span>{describeFrequency(s)}</span>
                        {optSummary && <span>· {optSummary}</span>}
                        {s.if_busy === 'skip' && <span>· skip if busy</span>}
                      </div>
                      {s.last_error && (
                        <p className="text-[11px] text-red-400/90 truncate" title={s.last_error}>
                          {s.last_error}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Next / Last run metadata */}
                  <div className="flex items-center gap-4 lg:gap-6 text-xs shrink-0 pl-12 lg:pl-0">
                    <div className="min-w-[115px]">
                      <div className="text-[10px] uppercase tracking-wider text-gray-600">Next run</div>
                      <div className="text-gray-300 font-medium mt-0.5" title={s.next_run_at ? fmtDateTime(s.next_run_at) : ''}>
                        {s.enabled && s.next_run_at ? fmtRelative(s.next_run_at, nowMs) : (s.enabled ? 'Done' : 'Paused')}
                      </div>
                      {s.enabled && s.next_run_at && (
                        <div className="text-[11px] text-gray-600">{fmtDateTime(s.next_run_at)}</div>
                      )}
                    </div>

                    <div className="min-w-[110px]">
                      <div className="text-[10px] uppercase tracking-wider text-gray-600">Last run</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {s.last_status ? (
                          s.last_job_id ? (
                            <button
                              type="button"
                              onClick={() => setLogModal({ jobId: s.last_job_id, title: `${s.name} · Log` })}
                              title="View job log"
                              className="hover:opacity-80 transition-opacity"
                            >
                              <StatusPill variant={statusVariant(s.last_status)}>{s.last_status}</StatusPill>
                            </button>
                          ) : (
                            <StatusPill variant={statusVariant(s.last_status)}>{s.last_status}</StatusPill>
                          )
                        ) : (
                          <span className="text-gray-600">Never</span>
                        )}
                      </div>
                      {s.last_run_at && (
                        <div className="text-[11px] text-gray-600 mt-0.5">{fmtRelative(s.last_run_at, nowMs)}</div>
                      )}
                    </div>
                  </div>

                  {/* Row controls */}
                  <div className="flex items-center gap-1.5 shrink-0 pl-12 lg:pl-0">
                    {confirmDelete === s.id ? (
                      <>
                        <span className="text-xs text-gray-400 mr-1">Delete?</span>
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={isBusy}
                          className="text-xs px-2.5 py-1 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleRunNow(s)}
                          disabled={isBusy || isRunning}
                          title="Run now"
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
                        >
                          <IconPlay />
                          Run
                        </button>
                        {s.last_job_id && (
                          <button
                            onClick={() => setLogModal({ jobId: s.last_job_id, title: `${s.name} · Log` })}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/25 transition-colors"
                          >
                            Log
                          </button>
                        )}
                        <button
                          onClick={() => { setEditing(s); setModalOpen(true) }}
                          title="Edit schedule"
                          className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/25 transition-colors"
                        >
                          <IconEdit />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(s.id)}
                          title="Delete schedule"
                          className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-red-300 hover:border-red-500/30 transition-colors"
                        >
                          <IconTrash />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Proxmox native backup schedules (read-only visibility) */}
      {nativeBackups.length > 0 && (
        <Card
          title="Proxmox Native Backup Schedules"
          subtitle="Read-only view of cluster backup jobs configured directly in Proxmox VE"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/[0.06]">
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Schedule</th>
                  <th className="px-5 py-2.5 font-medium">Target</th>
                  <th className="px-5 py-2.5 font-medium">Storage</th>
                  <th className="px-5 py-2.5 font-medium">Mode</th>
                  <th className="px-5 py-2.5 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {nativeBackups.map(b => (
                  <tr key={b.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-2.5">
                      <StatusPill variant={b.enabled ? 'success' : 'neutral'}>
                        {b.enabled ? 'enabled' : 'disabled'}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-gray-300">{b.schedule}</td>
                    <td className="px-5 py-2.5 text-gray-300">
                      {b.node ? `${b.node} · ` : ''}{b.all ? 'All guests' : (b.vmid ? `VMID ${b.vmid}` : '—')}
                    </td>
                    <td className="px-5 py-2.5 text-gray-400">{b.storage || '—'}</td>
                    <td className="px-5 py-2.5 text-gray-400">{b.mode || 'snapshot'}</td>
                    <td className="px-5 py-2.5 text-gray-500">{b.comment || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {modalOpen && (
        <ScheduleModal
          initial={editing}
          clusterNodes={clusterNodes}
          pairedNodes={pairedNodes}
          selfNode={selfNode}
          timezone={data.timezone || data.tz_abbr}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={() => { setModalOpen(false); setEditing(null); load() }}
        />
      )}

      {logModal && (
        <JobLogModal
          jobId={logModal.jobId}
          title={logModal.title}
          onClose={() => setLogModal(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#13131e] border border-red-500/30 text-red-400 text-xs px-4 py-2.5 rounded-xl shadow-2xl max-w-xs">
          {toast}
        </div>
      )}
    </div>
  )
}
