import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getHardware } from '../lib/api'
import { Card, StatCard, StatusPill } from './Card'
import { Expandable, useScrollReveal } from './motion'
import { loadingText } from '../lib/copy'

function fmtBytes(n) {
  if (!n || n <= 0) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  return `${(n / 1e6).toFixed(0)} MB`
}

function fmtHours(h) {
  if (h == null) return '—'
  if (h < 48) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 365) return `${days}d`
  const yrs = (days / 365).toFixed(1)
  return `${yrs}y (${days}d)`
}

function tempLevel(c, maxC, critC) {
  const high = critC ? critC - 10 : maxC ? maxC : 80
  const mid = Math.min(high - 12, 65)
  if (c >= high) return 'high'
  if (c >= mid) return 'mid'
  return 'low'
}

function zfsVariant(health) {
  const h = (health || '').toUpperCase()
  if (h === 'ONLINE') return 'success'
  if (h === 'DEGRADED') return 'warning'
  if (h === 'FAULTED' || h === 'UNAVAIL' || h === 'REMOVED') return 'error'
  return 'neutral'
}

// --- icons ---
function IconThermo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
    </svg>
  )
}
function IconDrive() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12"/>
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      <line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>
    </svg>
  )
}
function IconLayers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
    </svg>
  )
}
function IconFan() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/>
      <path d="M12 10C12 6 15 3 18 5c2 1.3 1 5-4 5"/>
      <path d="M14 12c4 0 7 3 5 6-1.3 2-5 1-5-4"/>
      <path d="M12 14c0 4-3 7-6 5-2-1.3-1-5 4-5"/>
      <path d="M10 12c-4 0-7-3-5-6 1.3-2 5-1 5 4"/>
    </svg>
  )
}
function IconRefresh({ spinning }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? 'animate-spin' : ''}>
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-4"/>
    </svg>
  )
}

function ZFSPoolCard({ pool }) {
  const [open, setOpen] = useState(pool.health !== 'ONLINE')
  const totalErrs = (pool.vdevs ?? []).reduce((s, v) => s + (v.read || 0) + (v.write || 0) + (v.cksum || 0), 0)
  const capHot = pool.cap_pct >= 90
  const capWarm = pool.cap_pct >= 75

  return (
    <div className="px-6 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-semibold font-mono text-white">{pool.name}</span>
          <StatusPill variant={zfsVariant(pool.health)}>{pool.health}</StatusPill>
          {totalErrs > 0 && <StatusPill variant="error">{totalErrs} I/O err{totalErrs !== 1 ? 's' : ''}</StatusPill>}
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 font-mono">
          <span>{fmtBytes(pool.alloc)} / {fmtBytes(pool.size)}</span>
          <span>frag {pool.frag_pct}%</span>
          {pool.vdevs?.length > 0 && (
            <button
              onClick={() => setOpen(v => !v)}
              aria-expanded={open}
              className="text-gray-400 hover:text-white transition-colors font-sans"
            >
              <span className={`inline-block mr-1 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
              {open ? 'Hide vdevs' : 'Vdevs'}
            </button>
          )}
        </div>
      </div>

      {/* Capacity bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full bar-fill ${capHot ? 'bg-red-400/80' : capWarm ? 'bg-amber-400/80' : 'bg-emerald-400/70'}`}
            style={{ width: `${Math.min(100, pool.cap_pct)}%` }}
          />
        </div>
        <span className={`text-xs font-mono w-10 text-right ${capHot ? 'text-red-400' : capWarm ? 'text-amber-400' : 'text-gray-400'}`}>
          {pool.cap_pct}%
        </span>
      </div>

      {(pool.scan || pool.errors) && (
        <div className="text-xs text-gray-500 space-y-0.5">
          {pool.scan && <p><span className="text-gray-600">Scan:</span> {pool.scan}</p>}
          {pool.errors && <p><span className="text-gray-600">Errors:</span> {pool.errors}</p>}
        </div>
      )}

      {pool.vdevs?.length > 0 && (
        <Expandable open={open}>
          <div className="pt-1 overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-600 border-b border-white/[0.06]">
                  <th className="text-left py-1.5 font-medium">Vdev / Device</th>
                  <th className="text-left py-1.5 font-medium">State</th>
                  <th className="text-right py-1.5 font-medium">Read</th>
                  <th className="text-right py-1.5 font-medium">Write</th>
                  <th className="text-right py-1.5 font-medium">Cksum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {pool.vdevs.map((v, i) => (
                  <tr key={`${v.name}-${i}`}>
                    <td className="py-1.5 text-gray-300" style={{ paddingLeft: `${v.indent * 14}px` }}>
                      {v.indent > 0 ? '└ ' : ''}{v.name}
                    </td>
                    <td className="py-1.5">
                      <span className={v.state === 'ONLINE' ? 'text-emerald-400' : v.state === 'DEGRADED' ? 'text-amber-400' : v.state ? 'text-red-400' : 'text-gray-600'}>
                        {v.state || '—'}
                      </span>
                    </td>
                    <td className={`py-1.5 text-right ${v.read > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>{v.read}</td>
                    <td className={`py-1.5 text-right ${v.write > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>{v.write}</td>
                    <td className={`py-1.5 text-right ${v.cksum > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>{v.cksum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Expandable>
      )}
    </div>
  )
}

export default function Hardware({ node = null }) {
  const loadingMsg = useMemo(() => loadingText('Reading hardware sensors…'), [])
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const containerRef = useRef(null)

  const load = useCallback((force = false) => {
    if (force) setRefreshing(true)
    return getHardware(node, force)
      .then((d) => { setData(d); setErr(null) })
      .catch((e) => setErr(e.message))
      .finally(() => setRefreshing(false))
  }, [node])

  useEffect(() => {
    setData(null)
    setErr(null)
    load(false)
    const t = setInterval(() => load(false), 15000)
    return () => clearInterval(t)
  }, [load])

  useScrollReveal(containerRef, { deps: [Boolean(data), node] })

  const summary = useMemo(() => {
    const sensors = data?.sensors ?? []
    const drives = data?.drives ?? []
    const pools = data?.zfs_pools ?? []

    let peakTemp = null
    let peakLabel = ''
    let fanCount = 0
    for (const g of sensors) {
      for (const t of g.temps ?? []) {
        if (peakTemp === null || t.current_c > peakTemp) {
          peakTemp = t.current_c
          peakLabel = `${g.chip} · ${t.label}`
        }
      }
      fanCount += (g.fans ?? []).length
    }
    for (const d of drives) {
      if (d.temp_c != null && (peakTemp === null || d.temp_c > peakTemp)) {
        peakTemp = d.temp_c
        peakLabel = d.model || d.device
      }
    }

    const drivesHealthy = drives.filter(d => d.passed === true).length
    const drivesFailed = drives.filter(d => d.passed === false).length
    const poolsHealthy = pools.filter(p => (p.health || '').toUpperCase() === 'ONLINE').length
    const poolsDegraded = pools.length - poolsHealthy

    return { peakTemp, peakLabel, fanCount, drivesHealthy, drivesFailed, driveTotal: drives.length, poolsHealthy, poolsDegraded, poolTotal: pools.length }
  }, [data])

  if (err && !data) {
    return (
      <div className="p-4 sm:p-8 max-w-5xl">
        <div className="bg-[#13131e] border border-amber-500/20 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-300 font-medium">Couldn't read hardware telemetry</p>
          <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">{err}</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="p-4 sm:p-8 text-sm text-gray-600">{loadingMsg}</div>
  }

  const sensors = data.sensors ?? []
  const drives = data.drives ?? []
  const pools = data.zfs_pools ?? []

  return (
    <div ref={containerRef} className="p-4 sm:p-8 space-y-6 max-w-6xl">
      {/* Top summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          data-reveal=""
          label="Peak Temp"
          value={summary.peakTemp === null ? '—' : summary.peakTemp}
          format={(n) => `${n.toFixed(1)}°C`}
          sub={summary.peakLabel || 'No thermal sensors'}
          icon={<IconThermo />}
        />
        <StatCard
          data-reveal=""
          label="SMART Drives"
          value={summary.driveTotal > 0 ? `${summary.drivesHealthy} / ${summary.driveTotal}` : '—'}
          sub={summary.drivesFailed > 0 ? `${summary.drivesFailed} failing SMART` : summary.driveTotal > 0 ? 'All passing SMART' : 'No drives detected'}
          icon={<IconDrive />}
        />
        <StatCard
          data-reveal=""
          label="ZFS Pools"
          value={summary.poolTotal > 0 ? `${summary.poolsHealthy} / ${summary.poolTotal}` : '—'}
          sub={summary.poolsDegraded > 0 ? `${summary.poolsDegraded} degraded/faulted` : summary.poolTotal > 0 ? 'All pools ONLINE' : 'No ZFS pools'}
          icon={<IconLayers />}
        />
        <StatCard
          data-reveal=""
          label="Cooling Fans"
          value={summary.fanCount > 0 ? summary.fanCount : '—'}
          sub={summary.fanCount > 0 ? 'Active tachometer sensors' : 'No fan sensors reported'}
          icon={<IconFan />}
        />
      </div>

      {/* Refresh bar */}
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-xs text-gray-500">
          Thermal sensors refresh live every 15s; SMART and ZFS probes cache for 60s.
        </p>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 disabled:opacity-40 transition-colors"
        >
          <IconRefresh spinning={refreshing} />
          {refreshing ? 'Scanning…' : 'Refresh all'}
        </button>
      </div>

      {/* Thermal & Fan Sensors */}
      <Card
        data-reveal=""
        icon={<IconThermo />}
        title="Thermal & Fan Sensors"
        subtitle="Hardware temperatures and fan speeds from sysfs (hwmon / thermal)"
      >
        {sensors.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-600">
            No hwmon or thermal zone sensors exposed on this host (common inside containers or virtualized guests).
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
            {sensors.map((group) => (
              <div key={group.chip} className="bg-[#0c0c14] border border-white/[0.06] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold font-mono text-gray-300">{group.chip}</span>
                  <span className="text-[11px] text-gray-600">
                    {(group.temps?.length || 0)} temp{(group.temps?.length || 0) !== 1 ? 's' : ''}
                    {(group.fans?.length || 0) > 0 ? ` · ${group.fans.length} fan${group.fans.length !== 1 ? 's' : ''}` : ''}
                  </span>
                </div>

                {(group.temps ?? []).length > 0 && (
                  <div className="space-y-2">
                    {group.temps.map((t) => {
                      const lvl = tempLevel(t.current_c, t.max_c, t.crit_c)
                      const cap = t.crit_c || t.max_c || 100
                      const pct = Math.max(0, Math.min(100, (t.current_c / cap) * 100))
                      const barCls = lvl === 'high' ? 'bg-red-400/80' : lvl === 'mid' ? 'bg-amber-400/80' : 'bg-emerald-400/70'
                      const txtCls = lvl === 'high' ? 'text-red-400' : lvl === 'mid' ? 'text-amber-400' : 'text-emerald-400'
                      return (
                        <div key={t.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="text-gray-400 truncate" title={t.label}>{t.label}</span>
                            <span className="font-mono shrink-0 flex items-center gap-2">
                              <span className={txtCls}>{t.current_c.toFixed(1)}°C</span>
                              {t.crit_c && <span className="text-[10px] text-gray-600">/ {t.crit_c.toFixed(0)}°C</span>}
                            </span>
                          </div>
                          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                            <div className={`h-full rounded-full bar-fill ${barCls}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {(group.fans ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/[0.05]">
                    {group.fans.map((f) => (
                      <span key={f.label} className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-gray-400">
                        <span className="text-gray-500">{f.label}:</span>
                        <span className="text-gray-200">{f.rpm} RPM</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ZFS Pools */}
      <Card
        data-reveal=""
        icon={<IconLayers />}
        title="ZFS Storage Pools"
        subtitle="Pool health, capacity, fragmentation, scrub status, and vdev error counters"
      >
        {pools.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-600">
            {data.zfs_note || 'No ZFS pools imported on this host.'}
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {pools.map((p) => <ZFSPoolCard key={p.name} pool={p} />)}
          </div>
        )}
      </Card>

      {/* SMART Drives */}
      <Card
        data-reveal=""
        icon={<IconDrive />}
        title="SMART Drive Health"
        subtitle="Physical disk health, temperature, wear level, and sector/media error counts"
      >
        {drives.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-600">
            {data.smart_note || 'No physical disks detected.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-600 border-b border-white/[0.06]">
                  <th className="text-left font-medium px-5 py-3">Drive</th>
                  <th className="text-left font-medium px-4 py-3">Health</th>
                  <th className="text-right font-medium px-4 py-3">Temp</th>
                  <th className="text-right font-medium px-4 py-3">Wear</th>
                  <th className="text-right font-medium px-4 py-3">Power On</th>
                  <th className="text-right font-medium px-5 py-3">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {drives.map((d) => {
                  const errCount = (d.reallocated || 0) + (d.pending || 0) + (d.uncorrectable || 0)
                  const wearHot = d.wear_percent != null && d.wear_percent >= 85
                  const wearWarm = d.wear_percent != null && d.wear_percent >= 65
                  return (
                    <tr key={d.device} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-200 font-medium">{d.model || d.device}</span>
                          {d.protocol && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                              {d.protocol}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-gray-600 mt-0.5">
                          {d.device}
                          {d.capacity_bytes ? ` · ${fmtBytes(d.capacity_bytes)}` : ''}
                          {d.serial ? ` · S/N ${d.serial}` : ''}
                        </div>
                        {d.error && <p className="text-[11px] text-amber-400 mt-0.5">{d.error}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {d.passed === true ? (
                          <StatusPill variant="success">PASSED</StatusPill>
                        ) : d.passed === false ? (
                          <StatusPill variant="error">FAILED</StatusPill>
                        ) : (
                          <StatusPill variant="neutral">Unknown</StatusPill>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {d.temp_c != null ? (
                          <span className={d.temp_c >= 65 ? 'text-red-400' : d.temp_c >= 50 ? 'text-amber-400' : 'text-gray-300'}>
                            {d.temp_c}°C
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {d.wear_percent != null ? (
                          <div className="inline-flex items-center gap-2">
                            <div className="w-12 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${wearHot ? 'bg-red-400/80' : wearWarm ? 'bg-amber-400/80' : 'bg-blue-400/60'}`}
                                style={{ width: `${Math.min(100, d.wear_percent)}%` }}
                              />
                            </div>
                            <span className={wearHot ? 'text-red-400' : wearWarm ? 'text-amber-400' : 'text-gray-400'}>
                              {d.wear_percent}%
                            </span>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-400">
                        {fmtHours(d.power_on_hours)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs">
                        {errCount > 0 ? (
                          <span
                            className="text-red-400 font-semibold"
                            title={[
                              d.reallocated ? `Reallocated: ${d.reallocated}` : null,
                              d.pending ? `Pending: ${d.pending}` : null,
                              d.uncorrectable ? `Uncorrectable/Media: ${d.uncorrectable}` : null,
                            ].filter(Boolean).join(' · ')}
                          >
                            {errCount}
                          </span>
                        ) : (
                          <span className="text-gray-600">0</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
