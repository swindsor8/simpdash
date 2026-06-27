import { useEffect, useState } from 'react'
import { getNetwork } from '../lib/api'

const TYPE_ORDER = ['bridge', 'bond', 'eth', 'vlan', 'OVSBridge', 'OVSBond', 'OVSPort', 'OVSIntPort', 'alias', 'loopback']

function typeLabel(t) {
  const map = { bridge: 'Bridge', bond: 'Bond', eth: 'NIC', vlan: 'VLAN', loopback: 'Loopback' }
  return map[t] || t
}

function typeBadge(t) {
  const styles = {
    bridge: 'bg-blue-500/10 text-blue-400',
    bond: 'bg-purple-500/10 text-purple-400',
    eth: 'bg-emerald-500/10 text-emerald-400',
    vlan: 'bg-yellow-500/10 text-yellow-400',
    loopback: 'bg-white/5 text-gray-500',
  }
  return styles[t] || 'bg-white/5 text-gray-400'
}

export default function Network() {
  const [ifaces, setIfaces] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getNetwork()
      .then(setIfaces)
      .catch(e => setErr(e.message))
  }, [])

  if (err) return (
    <div className="p-8 text-sm text-red-400">{err}</div>
  )
  if (!ifaces) return (
    <div className="p-8 text-sm text-gray-600">Loading network interfaces…</div>
  )

  const sorted = [...ifaces].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type), bi = TYPE_ORDER.indexOf(b.type)
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.iface.localeCompare(b.iface)
  })

  return (
    <div className="p-8 max-w-5xl">
      <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Interface</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">IP / CIDR</th>
              <th className="text-left px-4 py-3 font-medium">Gateway</th>
              <th className="text-left px-4 py-3 font-medium">Bridge Ports</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(iface => {
              const cidr = iface.cidr || (iface.address && iface.netmask
                ? `${iface.address}/${iface.netmask}`
                : iface.address || '—')
              return (
                <tr key={iface.iface} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-mono text-gray-200">{iface.iface}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-md font-mono ${typeBadge(iface.type)}`}>
                      {typeLabel(iface.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-400 text-xs">{cidr}</td>
                  <td className="px-4 py-3 font-mono text-gray-400 text-xs">{iface.gateway || '—'}</td>
                  <td className="px-4 py-3 font-mono text-gray-400 text-xs">{iface.bridge_ports || '—'}</td>
                  <td className="px-4 py-3">
                    {iface.active
                      ? <span className="text-xs text-emerald-400">Active</span>
                      : <span className="text-xs text-gray-600">Down</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
