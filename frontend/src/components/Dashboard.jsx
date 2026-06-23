import { logout } from '../lib/api'
import { useResourceStream } from '../hooks/useResourceStream'
import Updates from './Updates'

function fmtBytes(n) {
  if (n == null) return '—'
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h`
}

function Bar({ value, max, color = 'bg-blue-500' }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const c = p > 90 ? 'bg-red-500' : p > 70 ? 'bg-yellow-500' : color
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${c} transition-all duration-700`} style={{ width: `${p}%` }} />
    </div>
  )
}

// Re-keyed by pulseKey on each update so the CSS ping animation re-fires.
function StatusDot({ pulseKey, connected }) {
  const color = connected ? 'bg-green-400' : 'bg-gray-600'
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {connected && (
        <span key={pulseKey} className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping-once" />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  )
}

function StatusPill({ status }) {
  const on = status === 'running' || status === 'online'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${on ? 'bg-green-900/60 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
      {status}
    </span>
  )
}

function GuestRow({ item, type }) {
  const running = item.status === 'running'
  return (
    <tr className="border-t border-gray-800/60">
      <td className="py-2 pr-4">
        <span className="text-xs text-gray-600 mr-1.5">{type}{item.vmid}</span>
        <span className="text-sm text-gray-300">{item.name}</span>
      </td>
      <td className="py-2 pr-4"><StatusPill status={item.status} /></td>
      <td className="py-2 pr-4 text-sm text-gray-400 tabular-nums">
        {running ? `${(item.cpu * 100).toFixed(1)}%` : '—'}
      </td>
      <td className="py-2 text-sm text-gray-400 tabular-nums">
        {running ? `${fmtBytes(item.mem)} / ${fmtBytes(item.maxmem)}` : '—'}
      </td>
    </tr>
  )
}

function NodeCard({ node }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-white">{node.id}</h2>
          <p className="text-xs text-gray-600 mt-0.5">up {fmtUptime(node.uptime)}</p>
        </div>
        <StatusPill status={node.status} />
      </div>

      <div className="space-y-3.5 mb-6">
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
          <Bar value={node.disk} max={node.maxdisk} color="bg-violet-500" />
        </div>
      </div>

      {(node.vms.length > 0 || node.lxcs.length > 0) && (
        <div className="border-t border-gray-800 pt-4">
          <table className="w-full">
            <thead>
              <tr>
                {['Name', 'Status', 'CPU', 'Memory'].map(h => (
                  <th key={h} className="text-left text-xs text-gray-600 font-medium pb-2">{h}</th>
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

export default function Dashboard({ onLogout }) {
  const { nodes, connected, pulseKey } = useResourceStream()

  async function handleLogout() {
    await logout()
    onLogout()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-white">SimpDash</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-xs text-gray-500">
            <StatusDot pulseKey={pulseKey} connected={connected} />
            {connected ? 'live' : 'reconnecting…'}
          </span>
          <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-white transition-colors">
            Sign out
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-4">
        {nodes === null ? (
          <p className="text-gray-600 text-sm text-center py-12">Connecting to Proxmox…</p>
        ) : nodes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No nodes reporting.</p>
            <p className="text-gray-600 text-xs mt-1">Proxmox may be unavailable or monitoring is still provisioning.</p>
          </div>
        ) : (
          nodes.map(node => <NodeCard key={node.id} node={node} />)
        )}
        <Updates />
      </main>
    </div>
  )
}
