import { useState, useEffect, useRef } from 'react'
import { getRRD } from '../lib/api'
import { useStrokeDraw } from './motion'

const TIMEFRAMES = [
  { id: 'hour', label: '1h' },
  { id: 'day', label: '24h' },
  { id: 'week', label: '7d' },
]

function fmtRate(bytesPerSec) {
  if (bytesPerSec == null || Number.isNaN(bytesPerSec)) return '—'
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
}

function fmtTs(unixSec, timeframe) {
  if (!unixSec) return ''
  const d = new Date(unixSec * 1000)
  if (timeframe === 'week') {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// InteractiveSpark renders an SVG area/line sparkline with hover scrubber
// and live readout of the hovered sample.
function InteractiveSpark({ label, values, times, timeframe, color, formatVal, maxOverride, width = 108, height = 26 }) {
  const lineRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const ready = Boolean(values && values.length >= 2)
  useStrokeDraw(lineRef, ready)

  if (!ready) return null
  const max = maxOverride != null ? maxOverride : Math.max(...values, 0.0001)
  const step = width / (values.length - 1)
  const coords = values.map((v, i) => {
    const x = i * step
    const y = height - (Math.max(0, Math.min(max, v)) / max) * (height - 4) - 2
    return [x, y]
  })
  const pts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const poly = `0,${height} ${pts} ${width},${height}`
  const activeIdx = hoverIdx !== null ? hoverIdx : values.length - 1
  const activeVal = values[activeIdx]
  const activeTime = times?.[activeIdx]
  const [hx, hy] = coords[activeIdx]

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverIdx(Math.round(rel * (values.length - 1)))
  }

  return (
    <div
      className="flex flex-col gap-1 min-w-0"
      onMouseLeave={() => setHoverIdx(null)}
    >
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="uppercase tracking-wider text-gray-600">{label}</span>
        <span className="font-mono text-gray-400 tabular-nums truncate">
          {formatVal(activeVal)}
          {hoverIdx !== null && activeTime ? <span className="text-gray-600 ml-1">· {fmtTs(activeTime, timeframe)}</span> : null}
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMove}
        className="w-full overflow-visible cursor-crosshair"
        aria-label={`${label} trend`}
      >
        <polygon points={poly} fill={color} fillOpacity="0.12" />
        <polyline
          ref={lineRef}
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
        />
        {hoverIdx !== null && (
          <>
            <line x1={hx} y1={0} x2={hx} y2={height} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <circle cx={hx} cy={hy} r="2.5" fill={color} />
          </>
        )}
      </svg>
    </div>
  )
}

// NodeTrends renders PVE RRD history (CPU, Memory, and Network I/O) with a
// 1h / 24h / 7d timeframe switcher and interactive hover inspection.
export default function NodeTrends({ nodeId, online }) {
  const [tf, setTf] = useState('hour')
  const [pts, setPts] = useState(null)

  useEffect(() => {
    if (!online) return
    let live = true
    const load = () => getRRD(nodeId, tf).then(d => live && setPts(d)).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => { live = false; clearInterval(t) }
  }, [nodeId, online, tf])

  if (!online) return null

  const clean = (pts ?? []).filter(p => p && (p.cpu != null || p.memtotal != null || p.netin != null))
  if (clean.length < 2) return null

  const times = clean.map(p => p.time)
  const cpu = clean.map(p => (p.cpu ?? 0) * 100)
  const mem = clean.map(p => (p.memtotal ? ((p.memused ?? 0) / p.memtotal) * 100 : 0))
  const net = clean.map(p => (p.netin ?? 0) + (p.netout ?? 0))
  const hasNet = net.some(v => v > 0)

  return (
    <div className="mt-4 pt-3 border-t border-white/[0.06] space-y-2.5" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-600">History (PVE RRD)</span>
        <div className="inline-flex items-center gap-0.5 bg-[#0c0c14] border border-white/[0.06] rounded-lg p-0.5">
          {TIMEFRAMES.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTf(item.id)}
              className={`text-[10px] px-2 py-0.5 rounded-md font-mono transition-colors ${
                tf === item.id
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid gap-4 ${hasNet ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
        <InteractiveSpark
          key={`cpu-${tf}`}
          label="CPU"
          values={cpu}
          times={times}
          timeframe={tf}
          color="#60a5fa"
          formatVal={(v) => `${v.toFixed(1)}%`}
          maxOverride={100}
        />
        <InteractiveSpark
          key={`mem-${tf}`}
          label="Memory"
          values={mem}
          times={times}
          timeframe={tf}
          color="#34d399"
          formatVal={(v) => `${v.toFixed(1)}%`}
          maxOverride={100}
        />
        {hasNet && (
          <InteractiveSpark
            key={`net-${tf}`}
            label="Net I/O"
            values={net}
            times={times}
            timeframe={tf}
            color="#a78bfa"
            formatVal={fmtRate}
          />
        )}
      </div>
    </div>
  )
}
