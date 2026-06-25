import { useState } from 'react'
import { logout } from '../lib/api'
import { useResourceStream } from '../hooks/useResourceStream'
import Updates from './Updates'
import Scripts from './Scripts'

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

function NodeCard({ node }) {
  return (
    <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-white">{node.id}</h2>
          <p className="text-xs text-gray-600 mt-0.5">up {fmtUptime(node.uptime)}</p>
        </div>
        <StatusPill status={node.status} />
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
    </div>
  )
}

function GuestRow({ item, type }) {
  const running = item.status === 'running'
  return (
    <tr className="border-t border-white/[0.04]">
      <td className="py-2 pr-3 text-sm text-gray-300">{item.name}</td>
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
  )
}

// --- main ---
export default function Dashboard({ onLogout }) {
  const [view, setView] = useState('dashboard') // 'dashboard' | 'scripts'
  const { nodes, connected, pulseKey } = useResourceStream()

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

        <nav className="flex-1 px-2 space-y-0.5">
          <NavItem icon={<IconGrid />} label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <NavItem icon={<IconTerminal />} label="Scripts" active={view === 'scripts'} onClick={() => setView('scripts')} />
        </nav>

        <div className="px-2 pt-3 border-t border-white/[0.06]">
          <NavItem icon={<IconLogout />} label="Sign out" onClick={handleLogout} />
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

      {view === 'scripts' ? (
        <>
          <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4">
            <h1 className="text-base font-semibold">Script Catalog</h1>
            <p className="text-xs text-gray-500 mt-0.5">One-click community-scripts installs</p>
          </header>
          <Scripts />
        </>
      ) : (
        <>

        {/* Header */}
        <header className="sticky top-0 z-10 bg-[#0c0c14]/90 backdrop-blur-sm border-b border-white/[0.06] px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Node Overview</h1>
            <p className="text-xs text-gray-500 mt-0.5">Live Proxmox resource usage</p>
          </div>
          <div className="flex items-center gap-2.5">
            <StatusDot pulseKey={pulseKey} connected={connected} />
            <span className="text-xs text-gray-500">{connected ? 'Live' : 'Reconnecting…'}</span>
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

          {/* Node cards */}
          {nodes === null ? (
            <div className="text-center py-16 text-gray-600 text-sm">Connecting to Proxmox…</div>
          ) : nodes.length === 0 ? (
            <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-12 text-center">
              <p className="text-gray-400 text-sm">No nodes reporting.</p>
              <p className="text-gray-600 text-xs mt-1">Proxmox may be unavailable or credentials are not provisioned yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {nodes.map(node => <NodeCard key={node.id} node={node} />)}
            </div>
          )}

          {/* Updates */}
          <Updates />

        </main>
        </>
      )}
      </div>
    </div>
  )
}
