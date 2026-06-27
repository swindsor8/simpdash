import { useState, useEffect, useCallback } from 'react'
import { logout, getNodes, getGuestServices } from '../lib/api'
import { useResourceStream } from '../hooks/useResourceStream'
import Updates from './Updates'
import Scripts from './Scripts'
import Themes from './Themes'
import Nodes from './Nodes'
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

function NodeCard({ node, onInstallAgent }) {
  const monitorOnly = node.managed === false
  return (
    <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6">
      <div className="flex items-start justify-between mb-5 gap-2">
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

      {(node.vms.length > 0 || node.lxcs.length > 0) && (
        <div className="border-t border-white/[0.06] pt-4">
          <table className="w-full">
            <thead>
              <tr>
                {['Name', 'Type', 'Status', 'CPU', 'Memory'].map(h => (
                  <th key={h} className="text-left text-xs text-gray-600 font-medium pb-2.5 pr-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.vms.map(vm => <GuestRow key={vm.vmid} item={vm} type="VM" />)}
              {node.lxcs.map(ct => <GuestRow key={ct.vmid} item={ct} type="CT" />)}
            </tbody>
          </table>
        </div>
      )}

      {monitorOnly && (
        <div className="border-t border-white/[0.06] pt-4 mt-1 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-600">
            No SimpDash agent here — stats only. Pair an agent for updates &amp; script installs.
          </p>
          <button
            onClick={onInstallAgent}
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            Install agent
          </button>
        </div>
      )}
    </div>
  )
}

// GuestRow is a VM/LXC row that expands (when running) to list the services
// running inside the guest — pct exec for CTs, qm guest exec for VMs.
function GuestRow({ item, type }) {
  const running = item.status === 'running'
  const [open, setOpen] = useState(false)
  const [svc, setSvc] = useState(null) // null = not fetched yet
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  async function toggle() {
    if (!running) return
    const next = !open
    setOpen(next)
    if (next && svc === null && !loading) {
      setLoading(true)
      setErr(null)
      try {
        setSvc(await getGuestServices(item.vmid, type === 'VM' ? 'qemu' : 'lxc'))
      } catch (e) {
        setErr(e.message)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <>
      <tr
        className={`border-t border-white/[0.04] ${running ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
        onClick={toggle}
      >
        <td className="py-2 pr-3 text-sm text-gray-300">
          <span className="inline-block w-3 text-gray-600">{running ? (open ? '▾' : '▸') : ''}</span>
          {item.name}
        </td>
        <td className="py-2 pr-3">
          <span className="text-xs text-gray-600 font-mono">{type}{item.vmid}</span>
        </td>
        <td className="py-2 pr-3"><StatusPill status={item.status} /></td>
        <td className="py-2 pr-3 text-xs text-gray-500 tabular-nums">
          {running ? `${(item.cpu * 100).toFixed(1)}%` : '—'}
        </td>
        <td className="py-2 text-xs text-gray-500 tabular-nums">
          {running ? fmtBytes(item.mem) : '—'}
        </td>
      </tr>
      {open && (
        <tr className="bg-white/[0.015]">
          <td colSpan={5} className="px-3 pb-3 pt-1">
            {loading && <p className="text-xs text-gray-600">Loading services…</p>}
            {err && (
              <div className="text-xs text-red-400 space-y-1">
                <p>{err}</p>
                {type === 'VM' && (
                  <p className="text-gray-500">Run inside the VM: <code className="bg-white/5 px-1 rounded font-mono text-gray-300">apt install -y qemu-guest-agent && systemctl enable --now qemu-guest-agent</code></p>
                )}
              </div>
            )}
            {svc && svc.length === 0 && <p className="text-xs text-gray-600">No running services reported.</p>}
            {svc && svc.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {svc.map(s => (
                  <span
                    key={s.name}
                    title={s.description}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// --- main ---
export default function Dashboard({ onLogout, theme, setTheme }) {
  const [view, setView] = useState('dashboard') // 'dashboard' | 'scripts' | 'themes' | 'nodes'
  const [pairedNodes, setPairedNodes] = useState([])
  const [activeNode, setActiveNode] = useState(null) // null = local host

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
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-xs font-bold">S</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">SimpDash</span>
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
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {nodes.map(node => <NodeCard key={node.id} node={node} onInstallAgent={() => setView('nodes')} />)}
            </div>
          )}

          {/* Updates — hidden while the node is unreachable (nothing to act on). */}
          {!unreachable && <Updates node={activeNode} />}

        </main>
        </>
      )}
      </div>
    </div>
  )
}
