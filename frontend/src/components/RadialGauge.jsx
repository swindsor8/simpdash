// RadialGauge — one hand-built SVG gauge shared by the node card (large) and the
// VM/LXC cards (compact). The SAME markup renders two looks; which SVG bits show
// is decided entirely in CSS by the active theme (see the RADIAL GAUGES block in
// index.css): the default theme shows a threshold-coloured progress ring, the
// terminal theme shows a monochrome analog dial (ticks + needle, no arc fill).
//
// The arc sweeps to new values over --motion-medium via a CSS transition on
// stroke-dashoffset (the needle does the same via a transform transition), so it
// animates in lockstep with the AnimatedNumber in the centre rather than snapping.

import { AnimatedNumber } from './motion'

// 270° arc with the gap at the bottom — reads as a ring AND as an analog dial.
const CX = 50, CY = 50, R = 42, START = 135, SWEEP = 270
const polar = (deg) => {
  const a = (deg * Math.PI) / 180
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)]
}
const [SX, SY] = polar(START)
const [EX, EY] = polar(START + SWEEP)
// large-arc + clockwise (sweep > 180°, increasing angle in SVG's y-down space).
const ARC_D = `M${SX.toFixed(2)} ${SY.toFixed(2)} A${R} ${R} 0 1 1 ${EX.toFixed(2)} ${EY.toFixed(2)}`

// Evenly spaced tick marks along the arc (terminal dial only; hidden by CSS off-terminal).
const TICKS = [...Array(11)].map((_, i) => {
  const a = ((START + SWEEP * (i / 10)) * Math.PI) / 180
  const [r1, r2] = [R + 4, R - 5]
  return [CX + r1 * Math.cos(a), CY + r1 * Math.sin(a), CX + r2 * Math.cos(a), CY + r2 * Math.sin(a)]
})

const pctFormat = (n) => `${Math.round(n)}%`

export default function RadialGauge({ value, max, label, size = 'lg', idle = false, naLabel = 'N/A', format = pctFormat }) {
  const noData = value == null || max == null || max <= 0
  const frac = noData || idle ? 0 : Math.max(0, Math.min(1, value / max))
  const pct = frac * 100
  // Drives both the default-theme arc colour and the terminal-theme glow intensity.
  const level = noData ? 'na' : idle ? 'idle' : frac >= 0.9 ? 'high' : frac >= 0.7 ? 'mid' : 'low'
  const live = !noData && !idle
  const valueCls = size === 'sm'
    ? 'text-[11px] font-semibold text-white tabular-nums leading-none'
    : 'text-lg font-bold text-white tabular-nums leading-none'

  return (
    <div className={`radial-gauge ${size === 'sm' ? 'rg-sm' : 'rg-lg'}`} data-level={level}>
      <svg viewBox="0 0 100 100" className="rg-svg" aria-hidden="true">
        <path className="gauge-track" d={ARC_D} pathLength="100" />
        {live && (
          <path className="gauge-fill" d={ARC_D} pathLength="100" style={{ strokeDashoffset: 100 - pct }} />
        )}
        <g className="gauge-ticks">
          {TICKS.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />)}
        </g>
        {live && (
          <>
            <line className="gauge-needle" x1="50" y1="50" x2="50" y2="13" style={{ transform: `rotate(${270 * frac - 135}deg)` }} />
            <circle className="gauge-hub" cx="50" cy="50" r="3.5" />
          </>
        )}
      </svg>
      <div className="rg-center">
        <span className={valueCls}>
          {noData ? naLabel : idle ? '—' : <AnimatedNumber value={pct} format={format} />}
        </span>
        {label && <span className="rg-label text-gray-500">{label}</span>}
      </div>
    </div>
  )
}
