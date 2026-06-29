import { useEffect, useMemo, useRef, useState } from 'react'
import { getNetwork, getNetworkStats, runSpeedtest, getConnectivity, getSpeedtestHistory } from '../lib/api'
import { loadingText } from '../lib/copy'

const TYPE_ORDER = ['bridge', 'bond', 'eth', 'vlan', 'OVSBridge', 'OVSBond', 'OVSPort', 'OVSIntPort', 'alias', 'loopback']
const HISTORY_LEN = 40 // samples kept for sparklines (~80 s at the 2 s poll)

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

function fmtSpeed(mbps) {
  if (!mbps || mbps <= 0) return '—'
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(mbps % 1000 ? 1 : 0)} Gb/s`
  return `${mbps} Mb/s`
}

function push(arr, v) {
  arr.push(v)
  if (arr.length > HISTORY_LEN) arr.shift()
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

// Sparkline draws a normalized polyline (+ faint fill) from a series of values.
function Sparkline({ data, color = '#34d399', width = 90, height = 26 }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />
  const max = Math.max(...data, 1)
  const step = width / (data.length - 1)
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - (Math.max(0, v) / max) * height).toFixed(1)}`)
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={color} fillOpacity="0.12" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Dot({ ok }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
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

// LiveMetric — a hero throughput card with a live sparkline.
function LiveMetric({ icon, label, value, color, glow, history }) {
  return (
    <div className="relative rounded-2xl bg-white/5 border border-white/[0.06] p-4 overflow-hidden">
      <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-20 ${glow}`} />
      <div className={`flex items-center gap-2 text-xs font-medium ${color}`}>
        {icon}<span className="uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
        <Sparkline data={history} color={color === 'text-emerald-400' ? '#34d399' : '#60a5fa'} />
      </div>
    </div>
  )
}

export default function Network() {
  const loadingMsg = useMemo(() => loadingText('Loading…'), [])
  const [ifaces, setIfaces] = useState(null)
  const [rates, setRates] = useState({})       // iface → {rx, tx} bytes/s
  const [guestRates, setGuestRates] = useState([]) // [{vmid,name,type,status,rx,tx}]
  const [conn, setConn] = useState(null)
  const [err, setErr] = useState(null)
  const prev = useRef(null)        // host iface counters: { ifaces, t }
  const gstate = useRef({})        // per-vmid: { netin, netout, t, rx, tx }
  const hist = useRef({ total: { rx: [], tx: [] }, ifaces: {} }) // sparkline buffers
  const physRef = useRef([])       // physical NIC names, for the total

  const [hideDown, setHideDown] = useState(true)
  const [sort, setSort] = useState({ key: 'type', dir: 1 })

  const [stRunning, setStRunning] = useState(false)
  const [stResult, setStResult] = useState(null)
  const [stErr, setStErr] = useState(null)
  const [stHist, setStHist] = useState([])

  useEffect(() => {
    getNetwork().then(setIfaces).catch(e => setErr(e.message))
    getSpeedtestHistory().then(setStHist).catch(() => {})
  }, [])

  useEffect(() => {
    if (ifaces) physRef.current = ifaces.filter(i => i.type === 'eth').map(i => i.iface)
  }, [ifaces])

  // Connectivity probes are cheap; refresh every 30 s.
  useEffect(() => {
    let alive = true
    const load = () => getConnectivity().then(c => alive && setConn(c)).catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => { alive = false; clearInterval(id) }
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
          // sparkline history (read during render; setRates drives the re-render)
          for (const [iface, rate] of Object.entries(nr)) {
            if (!hist.current.ifaces[iface]) hist.current.ifaces[iface] = { rx: [], tx: [] }
            push(hist.current.ifaces[iface].rx, rate.rx)
            push(hist.current.ifaces[iface].tx, rate.tx)
          }
          let trx = 0, ttx = 0
          for (const name of physRef.current) { const r = nr[name]; if (r) { trx += r.rx; ttx += r.tx } }
          push(hist.current.total.rx, trx)
          push(hist.current.total.tx, ttx)
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
      getSpeedtestHistory().then(setStHist).catch(() => {})
    } catch (e) {
      setStErr(e.message)
    } finally {
      setStRunning(false)
    }
  }

  if (err) return <div className="p-8 text-sm text-red-400">{err}</div>
  if (!ifaces) return <div className="p-8 text-sm text-gray-600">{loadingMsg}</div>

  const visible = ifaces.filter(i => !hideDown || (i.type !== 'loopback' && i.active))
  const sorted = [...visible].sort((a, b) => {
    const d = sort.dir
    if (sort.key === 'iface') return d * a.iface.localeCompare(b.iface)
    if (sort.key === 'rx') return d * ((rates[b.iface]?.rx || 0) - (rates[a.iface]?.rx || 0))
    if (sort.key === 'tx') return d * ((rates[b.iface]?.tx || 0) - (rates[a.iface]?.tx || 0))
    const ai = TYPE_ORDER.indexOf(a.type), bi = TYPE_ORDER.indexOf(b.type)
    if (ai !== bi) return d * ((ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi))
    return d * a.iface.localeCompare(b.iface)
  })
  const hiddenCount = ifaces.length - visible.length

  const guestsSorted = [...guestRates].sort((a, b) => {
    if ((a.status === 'running') !== (b.status === 'running')) return a.status === 'running' ? -1 : 1
    return (b.rx + b.tx || 0) - (a.rx + a.tx || 0)
  })
  const maxGuest = Math.max(1, ...guestsSorted.map(g => Math.max(g.rx || 0, g.tx || 0)))

  const total = hist.current.total
  const curTotalRx = total.rx[total.rx.length - 1] ?? 0
  const curTotalTx = total.tx[total.tx.length - 1] ?? 0

  const stDownloads = stHist.map(h => h.download)

  function sortBy(key) {
    setSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 })
  }
  const arrow = (key) => sort.key === key ? (sort.dir === 1 ? ' ↓' : ' ↑') : ''

  return (
    <div className="p-8 max-w-5xl space-y-6">

      {/* Live throughput + connectivity */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/[0.06] bg-[#13131e] p-5 space-y-4">
          <h2 className="text-sm font-semibold">Total Throughput <span className="text-xs text-gray-500 font-normal">· physical NICs</span></h2>
          <div className="grid grid-cols-2 gap-3">
            <LiveMetric icon={<IconDown />} label="Down" value={fmtRate(curTotalRx)} color="text-emerald-400" glow="bg-emerald-500" history={total.rx} />
            <LiveMetric icon={<IconUp />} label="Up" value={fmtRate(curTotalTx)} color="text-blue-400" glow="bg-blue-500" history={total.tx} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#13131e] p-5">
          <h2 className="text-sm font-semibold mb-4">Connectivity</h2>
          {!conn ? (
            <p className="text-xs text-gray-600">Checking…</p>
          ) : (
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs uppercase tracking-wider">Internet</span>
                <span className="flex items-center gap-2 text-gray-300"><Dot ok={conn.internet_up} />{conn.internet_up ? 'Online' : 'Offline'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs uppercase tracking-wider">WAN IP</span>
                <span className="font-mono text-gray-300 text-xs">{conn.wan_ip || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 text-xs uppercase tracking-wider">Gateway</span>
                <span className="flex items-center gap-2 font-mono text-gray-300 text-xs">{conn.gateway || '—'} {conn.gateway && <Dot ok={conn.gateway_up} />}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-gray-500 text-xs uppercase tracking-wider">DNS</span>
                <span className="font-mono text-gray-300 text-xs text-right">{conn.dns?.length ? conn.dns.join(', ') : '—'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

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

        {stHist.length > 1 && (
          <div className="flex items-center gap-3 pt-1 border-t border-white/[0.06]">
            <span className="text-xs text-gray-500">Download trend</span>
            <Sparkline data={stDownloads} color="#34d399" width={140} height={24} />
            <span className="text-xs text-gray-600">{stHist.length} tests · last {fmtMbps(stHist[stHist.length - 1].download)} Mbps</span>
          </div>
        )}
      </div>

      {/* Host interfaces */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-semibold">Host Interfaces</h2>
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
            <input type="checkbox" checked={hideDown} onChange={e => setHideDown(e.target.checked)} className="accent-blue-500" />
            Hide down &amp; loopback{hiddenCount > 0 && hideDown ? ` (${hiddenCount})` : ''}
          </label>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#13131e] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium cursor-pointer hover:text-gray-300" onClick={() => sortBy('iface')}>Interface{arrow('iface')}</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">IP / CIDR</th>
                <th className="text-left px-4 py-3 font-medium">Link</th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-gray-300" onClick={() => sortBy('rx')}>↓ RX{arrow('rx')}</th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-gray-300" onClick={() => sortBy('tx')}>↑ TX{arrow('tx')}</th>
                <th className="text-left px-4 py-3 font-medium pl-6">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(iface => {
                const cidr = iface.cidr || (iface.address && iface.netmask
                  ? `${iface.address}/${iface.netmask}` : iface.address || '—')
                const r = rates[iface.iface]
                const h = hist.current.ifaces[iface.iface]
                const tip = [iface.mac && `MAC ${iface.mac}`, iface.gateway && `GW ${iface.gateway}`, iface.bridge_ports && `ports ${iface.bridge_ports}`]
                  .filter(Boolean).join(' · ')
                const down = iface.carrier === false
                return (
                  <tr key={iface.iface} className="border-t border-white/[0.04] hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-gray-300" title={tip}>{iface.iface}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-md font-mono ${typeBadge(iface.type)}`}>{typeLabel(iface.type)}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-400 text-xs">{cidr}</td>
                    <td className="px-4 py-3 font-mono text-gray-500 text-xs">
                      {fmtSpeed(iface.speed_mbps)}{iface.mtu ? ` · MTU ${iface.mtu}` : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Sparkline data={h?.rx} color="#34d399" width={56} height={18} />
                        <span className="font-mono text-xs text-emerald-400 w-20 inline-block text-right">{fmtRate(r?.rx)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Sparkline data={h?.tx} color="#60a5fa" width={56} height={18} />
                        <span className="font-mono text-xs text-blue-400 w-20 inline-block text-right">{fmtRate(r?.tx)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 pl-6">
                      {iface.active
                        ? <span className={`text-xs ${down ? 'text-yellow-400' : 'text-emerald-400'}`}>{down ? 'No carrier' : 'Active'}</span>
                        : <span className="text-xs text-gray-600">Down</span>}
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
        <h2 className="text-sm font-semibold mb-3 px-1">VM &amp; Container Traffic <span className="text-xs text-gray-500 font-normal">· top talkers first</span></h2>
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
                  const rxPct = running ? Math.min(100, ((g.rx || 0) / maxGuest) * 100) : 0
                  const txPct = running ? Math.min(100, ((g.tx || 0) / maxGuest) * 100) : 0
                  return (
                    <tr key={`${g.type}-${g.vmid}`} className="border-t border-white/[0.04] hover:bg-white/5">
                      <td className="px-4 py-3 text-gray-300">{g.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-600 font-mono">{g.type === 'qemu' ? 'VM' : 'CT'}{g.vmid}</span>
                      </td>
                      <td className="px-4 py-3">
                        {running ? <span className="text-xs text-emerald-400">running</span> : <span className="text-xs text-gray-600">{g.status}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-emerald-400/60" style={{ width: `${rxPct}%` }} /></div>
                          <span className="font-mono text-xs text-emerald-400 w-20 inline-block text-right">{running ? fmtRate(g.rx) : '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 pr-6">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden"><div className="h-full bg-blue-400/60" style={{ width: `${txPct}%` }} /></div>
                          <span className="font-mono text-xs text-blue-400 w-20 inline-block text-right">{running ? fmtRate(g.tx) : '—'}</span>
                        </div>
                      </td>
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
