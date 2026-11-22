// RadialGauge — one hand-built SVG gauge shared by the node card (large) and the
// VM/LXC cards (compact). The SAME markup renders two looks; which SVG bits show
// is decided entirely in CSS by the active theme (see the RADIAL GAUGES block in
// index.css): the default theme shows a threshold-coloured progress ring, the
// terminal theme shows a monochrome analog dial (ticks + needle, no arc fill).
//
// Arc fill and dial needle sweep from 0 on first mount and smoothly tween to
// live updates via GSAP using each theme's motion profile (instant on Win98 /
// prefers-reduced-motion), staying in lockstep with AnimatedNumber.

import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { AnimatedNumber } from './motion'
import { getThemeProfile, shouldAnimate } from '../lib/motionConfig'

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

  const fillRef = useRef(null)
  const needleRef = useRef(null)
  const tipRef = useRef(null)
  const mountedRef = useRef(false)
  const stateRef = useRef({ pct: 0 })

  useLayoutEffect(() => {
    if (!live) {
      mountedRef.current = false
      stateRef.current.pct = 0
      return
    }
    const fill = fillRef.current
    const needle = needleRef.current
    const tip = tipRef.current
    const profile = getThemeProfile()
    const animate = shouldAnimate() && Boolean(profile.gauge)

    const applyPct = (raw) => {
      const clamped = Math.max(0, Math.min(100, raw))
      const angle = 270 * (clamped / 100) - 135
      if (fill) gsap.set(fill, { strokeDashoffset: 100 - clamped })
      if (needle) gsap.set(needle, { rotation: angle, svgOrigin: '50 50' })
      if (tip) gsap.set(tip, { rotation: angle, svgOrigin: '50 50' })
    }

    if (!animate) {
      stateRef.current.pct = pct
      applyPct(pct)
      mountedRef.current = true
      return
    }

    const isFirst = !mountedRef.current
    mountedRef.current = true
    const dur = isFirst ? profile.gauge.duration : Math.min(0.55, profile.gauge.duration * 0.65)
    // Elastic overshoot looks awesome in the mid-range, while 0/100 endpoints stay crisp.
    const isElastic = typeof profile.gauge.ease === 'string' && profile.gauge.ease.startsWith('elastic')
    const ease = isElastic && (pct <= 2 || pct >= 97) ? 'power3.out' : profile.gauge.ease

    if (isFirst) stateRef.current.pct = 0
    applyPct(stateRef.current.pct)

    const tween = gsap.to(stateRef.current, {
      pct,
      duration: dur,
      ease,
      overwrite: 'auto',
      onUpdate: () => applyPct(stateRef.current.pct),
      onComplete: () => {
        stateRef.current.pct = pct
        applyPct(pct)
      },
    })

    return () => {
      tween.kill()
    }
  }, [live, pct, frac])

  return (
    <div className={`radial-gauge ${size === 'sm' ? 'rg-sm' : 'rg-lg'}`} data-level={level}>
      <svg viewBox="0 0 100 100" className="rg-svg" aria-hidden="true">
        <circle className="gauge-orbit" cx="50" cy="50" r="46.5" />
        <path className="gauge-track" d={ARC_D} pathLength="100" />
        {live && (
          <path ref={fillRef} className="gauge-fill" d={ARC_D} pathLength="100" />
        )}
        <g className="gauge-ticks">
          {TICKS.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />)}
        </g>
        {live && (
          <>
            <line ref={needleRef} className="gauge-needle" x1="50" y1="50" x2="50" y2="13" />
            <circle className="gauge-hub" cx="50" cy="50" r="3.5" />
            <g ref={tipRef} className="gauge-tip">
              <circle className="gauge-tip-halo" cx="50" cy="8" r="6.8" />
              <circle className="gauge-tip-dot" cx="50" cy="8" r="3.1" />
            </g>
          </>
        )}
      </svg>
      <div className="rg-center">
        <span className={valueCls}>
          {noData ? naLabel : idle ? '—' : <AnimatedNumber value={pct} format={format} from={0} duration={0.65} />}
        </span>
        {label && <span className="rg-label text-gray-500">{label}</span>}
      </div>
    </div>
  )
}
