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
  if (bytesPerSec < 0) bytesPerSec = 0
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
}

function fmtMbps(bitsPerSec) {
  return (bitsPerSec / 1_000_000).toFixed(1)
}

function IconDown() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M19 12l-7 7-7-7"/>
    </svg>
  )
}
function IconUp() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>
  )
}
function IconPing() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  )
}

// SpeedMetric is one hero result in the speed-test panel.
function SpeedMetric({ icon, label, value, unit, color, glow }) {
  return (
    <div className="relative rounded-2xl bg-white/5 border border-white/[0.06] p-5 overflow-hidden">
      <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-20 ${glow}`} />
      <div className={`flex items-center gap-2 text-xs font-medium ${color}`}>
        {icon}<span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={`text-4xl font-bold tabular-nums ${color}`}>{value}</span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
    </div>
  )
}

export default function Network() {
  const [ifaces, setIfaces] = useState(null)
  const [rates, setRates] = useState({})       // iface → {rx, tx} bytes/s
  const [guestRates, setGuestRates] = useState([]) // [{vmid,name,type,status,rx,tx}]
  const [err, setErr] = useState(null)
  const prev = useRef(null)        // host iface counters: { ifaces, t }
  const gstate = useRef({})        // per-vmid: { netin, netout, t, rx, tx }

  const [stRunning, setStRunning] = useState(false)
  const [stResult, setStResult] = useState(null)
  const [stErr, setStErr] = useState(null)

  useEffect(() => {
    getNetwork().then(setIfaces).catch(e => setErr(e.message))
  }, [])

  // Poll counters every 2 s. Host interfaces (/proc/net/dev) update in real
  // time, so a fixed 2 s diff is fine. Guest counters come from Proxmox
  // cluster/resources, which pvestatd only refreshes ~every 10 s — so we
  // compute each guest's rate over the actual interval between counter CHANGES
  // and hold the value between updates (else it would flicker 0 → spike → 0).
  const STALE_MS = 16000 // no counter change in this long ⇒ treat guest as idle
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const { ifaces: ifStats, guests } = await getNetworkStats()
        const now = Date.now()

        // host interfaces — straight 2 s diff
        if (prev.current) {
          const dt = (now - prev.current.t) / 1000
          const nr = {}
          for (const [iface, cur] of Object.entries(ifStats)) {
            const p = prev.current.ifaces[iface]
            if (p) nr[iface] = { rx: (cur.rx_bytes - p.rx_bytes) / dt, tx: (cur.tx_bytes - p.tx_bytes) / dt }
          }
          if (!cancelled) setRates(nr)
        }
        prev.current = { ifaces: ifStats, t: now }

        // guests — rate over time-between-changes, held in between
        const seen = new Set()
        const gr = guests.map(g => {
          seen.add(g.vmid)
          const st = gstate.current[g.vmid]
          if (!st) {
            gstate.current[g.vmid] = { netin: g.netin, netout: g.netout, t: now, rx: null, tx: null }
          } else if (g.netin !== st.netin || g.netout !== st.netout) {
            const dt = (now - st.t) / 1000
            st.rx = dt > 0 ? Math.max(0, (g.netin - st.netin) / dt) : st.rx
            st.tx = dt > 0 ? Math.max(0, (g.netout - st.netout) / dt) : st.tx
            st.netin = g.netin; st.netout = g.netout; st.t = now
          } else if (now - st.t > STALE_MS) {
            st.rx = 0; st.tx = 0 // counter idle ⇒ no traffic
          }
          const cur = gstate.current[g.vmid]
          return { vmid: g.vmid, name: g.name, type: g.type, status: g.status, rx: cur.rx, tx: cur.tx }
        })
        // drop state for guests that disappeared
        for (const k of Object.keys(gstate.current)) if (!seen.has(Number(k))) delete gstate.current[k]
        if (!cancelled) setGuestRates(gr)
      } catch (_) { /* best-effort */ }
      if (!cancelled) setTimeout(poll, 2000)
    }
    poll()
    return () => { cancelled = true }
  }, [])

  async function doSpeedtest() {
    setStRunning(true); setStErr(null); setStResult(null)
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

  const guestsSorted = [...guestRates].sort((a, b) => {
    if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1
    return (b.rx + b.tx || 0) - (a.rx + a.tx || 0)
  })

  return (
    <div className="p-8 max-w-5xl space-y-6">

      {/* Speed test */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#13131e] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Internet Speed Test</h2>
            <p className="text-xs text-gray-500 mt-0.5">Measure your WAN throughput via Speedtest.net</p>
          </div>
          <button
            onClick={doSpeedtest}
            disabled={stRunning}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {stRunning ? 'Testing…' : stResult ? 'Run Again' : 'Start Test'}
          </button>
        </div>

        {!stResult && !stErr && (
          <div className="grid grid-cols-3 gap-4">
            <SpeedMetric icon={<IconDown />} label="Download" value={stRunning ? '···' : '—'} unit="Mbps" color="text-emerald-400" glow="bg-emerald-500" />
            <SpeedMetric icon={<IconUp />} label="Upload" value={stRunning ? '···' : '—'} unit="Mbps" color="text-blue-400" glow="bg-blue-500" />
            <SpeedMetric icon={<IconPing />} label="Ping" value={stRunning ? '···' : '—'} unit="ms" color="text-yellow-400" glow="bg-yellow-500" />
          </div>
        )}

        {stRunning && (
          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full w-1/3 bg-emerald-400/60 rounded-full animate-pulse" style={{ animation: 'speedbar 1.2s ease-in-out infinite' }} />
          </div>
        )}

        {stErr && <p className="text-sm text-red-400">{stErr}</p>}

        {stResult && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <SpeedMetric icon={<IconDown />} label="Download" value={fmtMbps(stResult.download)} unit="Mbps" color="text-emerald-400" glow="bg-emerald-500" />
              <SpeedMetric icon={<IconUp />} label="Upload" value={fmtMbps(stResult.upload)} unit="Mbps" color="text-blue-400" glow="bg-blue-500" />
              <SpeedMetric icon={<IconPing />} label="Ping" value={stResult.ping.toFixed(1)} unit="ms" color="text-yellow-400" glow="bg-yellow-500" />
            </div>
            {stResult.server?.sponsor && (
              <p className="text-xs text-gray-600">
                via {stResult.server.sponsor} — {stResult.server.name}, {stResult.server.country}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Host interfaces */}
      <div>
        <h2 className="text-sm font-semibold mb-3 px-1">Host Interfaces</h2>
        <div className="rounded-2xl border border-white/[0.06] bg-[#13131e] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Interface</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">IP / CIDR</th>
                <th className="text-left px-4 py-3 font-medium">Gateway</th>
                <th className="text-left px-4 py-3 font-medium">Ports</th>
                <th className="text-right px-4 py-3 font-medium">↓ RX</th>
                <th className="text-right px-4 py-3 font-medium">↑ TX</th>
                <th className="text-left px-4 py-3 font-medium pl-6">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(iface => {
                const cidr = iface.cidr || (iface.address && iface.netmask
                  ? `${iface.address}/${iface.netmask}` : iface.address || '—')
                const r = rates[iface.iface]
                return (
                  <tr key={iface.iface} className="border-t border-white/[0.04] hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-gray-300">{iface.iface}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-md font-mono ${typeBadge(iface.type)}`}>{typeLabel(iface.type)}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs">{cidr}</td>
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs">{iface.gateway || '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs">{iface.bridge_ports || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">{fmtRate(r?.rx)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-blue-400">{fmtRate(r?.tx)}</td>
                    <td className="px-4 py-3 pl-6">
                      {iface.active ? <span className="text-xs text-emerald-400">Active</span> : <span className="text-xs text-gray-600">Down</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Guest network */}
      <div>
        <h2 className="text-sm font-semibold mb-3 px-1">VM &amp; Container Traffic</h2>
        <div className="rounded-2xl border border-white/[0.06] bg-[#13131e] overflow-hidden">
          {guestsSorted.length === 0 ? (
            <p className="px-4 py-6 text-xs text-gray-600">No guests reporting — Proxmox may be unavailable.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">Guest</th>
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">↓ RX</th>
                  <th className="text-right px-4 py-3 font-medium pr-6">↑ TX</th>
                </tr>
              </thead>
              <tbody>
                {guestsSorted.map(g => {
                  const running = g.status === 'running'
                  return (
                    <tr key={`${g.type}-${g.vmid}`} className="border-t border-white/[0.04] hover:bg-white/5">
                      <td className="px-4 py-3 text-gray-300">{g.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-600 font-mono">{g.type === 'qemu' ? 'VM' : 'CT'}{g.vmid}</span>
                      </td>
                      <td className="px-4 py-3">
                        {running ? <span className="text-xs text-emerald-400">running</span> : <span className="text-xs text-gray-600">{g.status}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">{running ? fmtRate(g.rx) : '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-blue-400 pr-6">{running ? fmtRate(g.tx) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  )
}
