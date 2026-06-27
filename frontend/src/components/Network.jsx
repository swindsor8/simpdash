import { useEffect, useRef, useState } from 'react'
import { getNetwork, getNetworkStats, runSpeedtest } from '../lib/api'

const TYPE_ORDER = ['bridge', 'bond', 'eth', 'vlan', 'OVSBridge', 'OVSBond', 'OVSPort', 'OVSIntPort', 'alias', 'loopback']

function typeLabel(t) {
  return { bridge: 'Bridge', bond: 'Bond', eth: 'NIC', vlan: 'VLAN', loopback: 'Loopback' }[t] || t
}

function typeBadge(t) {
  return {
    bridge: 'bg-blue-500/10 text-blue-400',
    bond: 'bg-purple-500/10 text-purple-400',
    eth: 'bg-emerald-500/10 text-emerald-400',
    vlan: 'bg-yellow-500/10 text-yellow-400',
    loopback: 'bg-white/5 text-gray-500',
  }[t] || 'bg-white/5 text-gray-400'
}

function fmtRate(bytesPerSec) {
  if (bytesPerSec === null || bytesPerSec === undefined) return '—'
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
}

function fmtMbps(bitsPerSec) {
  return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`
}

function SpeedCard({ label, value, sub, color }) {
  return (
    <div className="rounded-xl border border-white/[0.06] p-4 flex flex-col gap-1">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600">{sub}</p>}
    </div>
  )
}

export default function Network() {
  const [ifaces, setIfaces] = useState(null)
  const [rates, setRates] = useState({}) // iface → {rx, tx} bytes/s
  const [err, setErr] = useState(null)
  const prevStats = useRef(null)
  const prevTime = useRef(null)

  // Speed test state
  const [stRunning, setStRunning] = useState(false)
  const [stResult, setStResult] = useState(null)
  const [stErr, setStErr] = useState(null)

  useEffect(() => {
    getNetwork().then(setIfaces).catch(e => setErr(e.message))
  }, [])

  // Poll /proc/net/dev every 2 s to compute byte rates
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const stats = await getNetworkStats()
        const now = Date.now()
        if (prevStats.current && prevTime.current) {
          const dt = (now - prevTime.current) / 1000
          const newRates = {}
          for (const [iface, cur] of Object.entries(stats)) {
            const prev = prevStats.current[iface]
            if (prev) {
              newRates[iface] = {
                rx: (cur.rx_bytes - prev.rx_bytes) / dt,
                tx: (cur.tx_bytes - prev.tx_bytes) / dt,
              }
            }
          }
          if (!cancelled) setRates(newRates)
        }
        prevStats.current = stats
        prevTime.current = now
      } catch (_) { /* stats best-effort */ }
      if (!cancelled) setTimeout(poll, 2000)
    }
    poll()
    return () => { cancelled = true }
  }, [])

  async function doSpeedtest() {
    setStRunning(true)
    setStErr(null)
    setStResult(null)
    try {
      setStResult(await runSpeedtest())
    } catch (e) {
      setStErr(e.message)
    } finally {
      setStRunning(false)
    }
  }

  if (err) return <div className="p-8 text-sm text-red-400">{err}</div>
  if (!ifaces) return <div className="p-8 text-sm text-gray-600">Loading…</div>

  const sorted = [...ifaces].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type), bi = TYPE_ORDER.indexOf(b.type)
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.iface.localeCompare(b.iface)
  })

  return (
    <div className="p-8 max-w-5xl space-y-6">

      {/* Speed test */}
      <div className="rounded-2xl border border-white/[0.06] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Speed Test</h2>
            <p className="text-xs text-gray-500 mt-0.5">Requires <code className="bg-white/5 px-1 rounded font-mono">speedtest-cli</code> — <span className="font-mono">apt install -y speedtest-cli</span></p>
          </div>
          <button
            onClick={doSpeedtest}
            disabled={stRunning}
            className="px-4 py-1.5 rounded-lg text-sm bg-white/[0.06] hover:bg-white/[0.10] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {stRunning ? 'Running…' : 'Run Test'}
          </button>
        </div>

        {stRunning && (
          <p className="text-xs text-gray-500 animate-pulse">Testing — this takes ~15–30 seconds…</p>
        )}
        {stErr && (
          <p className="text-xs text-red-400">{stErr}</p>
        )}
        {stResult && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <SpeedCard label="Download" value={fmtMbps(stResult.download)} color="text-emerald-400" />
              <SpeedCard label="Upload" value={fmtMbps(stResult.upload)} color="text-blue-400" />
              <SpeedCard label="Ping" value={`${stResult.ping.toFixed(1)} ms`} color="text-yellow-400" />
            </div>
            {stResult.server?.sponsor && (
              <p className="text-xs text-gray-600">
                Server: {stResult.server.sponsor} — {stResult.server.name}, {stResult.server.country}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Interface table */}
      <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Interface</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">IP / CIDR</th>
              <th className="text-left px-4 py-3 font-medium">Gateway</th>
              <th className="text-left px-4 py-3 font-medium">Bridge Ports</th>
              <th className="text-right px-4 py-3 font-medium">RX</th>
              <th className="text-right px-4 py-3 font-medium">TX</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(iface => {
              const cidr = iface.cidr || (iface.address && iface.netmask
                ? `${iface.address}/${iface.netmask}`
                : iface.address || '—')
              const r = rates[iface.iface]
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
                  <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">{fmtRate(r?.rx)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-blue-400">{fmtRate(r?.tx)}</td>
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
