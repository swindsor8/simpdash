// Shared dashboard card chrome + status primitives.
//
// IMPORTANT: every surface here emits the literal classes the theme system keys
// on — `bg-[#13131e]` + `rounded-2xl` for the card, and `text-emerald/amber/red-400`
// + `bg-white/8` for pills. All 8 themes (nocturne/default/retro/mario/win98/
// terminal/glass/kinetic) override those class names by name in index.css, so reusing
// them keeps every template cohesive with zero per-component theme branching.

import { useRef } from 'react'
import { AnimatedNumber, useChangeFlash, useCardSpotlight } from './motion'

// Card — the elevated surface used across the dashboard. Pass icon/title/
// subtitle/action to get the standard header row; omit them for bespoke cards.
export function Card({ icon, title, subtitle, action, className = '', onClick, spotlight = false, children, ...rest }) {
  const titled = title || action
  const ref = useRef(null)
  useCardSpotlight(ref, spotlight)
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`bg-[#13131e] border border-white/[0.07] rounded-2xl ${spotlight ? 'card-spot' : ''} ${className}`}
      {...rest}
    >
      {titled && (
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <span className="w-8 h-8 rounded-xl bg-white/5 border border-white/[0.06] flex items-center justify-center text-gray-400 shrink-0">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white tracking-tight truncate">{title}</h2>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

const PILL = {
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  error: 'bg-red-500/15 text-red-400',
  info: 'bg-blue-500/15 text-blue-300',
  neutral: 'bg-white/8 text-gray-400',
}

// StatusPill — soft tinted badge for any status/outcome.
export function StatusPill({ variant = 'neutral', className = '', title, children }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${PILL[variant] ?? PILL.neutral} ${className}`}>
      {children}
    </span>
  )
}

// statusVariant maps a Proxmox running/online string to a pill variant.
export const statusVariant = (s) => (s === 'running' || s === 'online' ? 'success' : 'neutral')

export function TrendPill({ dir, pct }) {
  const up = dir === 'up'
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-md font-medium ${
      up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
    }`}>
      {up ? '↑' : '↓'}{pct}
    </span>
  )
}

// StatCard — KPI tile with icon, live numeric tween, optional micro progress
// footer (`meter`: 0..100), and subtle change flash.
export function StatCard({ icon, label, value, format, sub, trend, action, loading, meter, ...rest }) {
  const numeric = typeof value === 'number'
  const flashKey = useChangeFlash(numeric ? value : null)
  const meterPct = typeof meter === 'number' ? Math.max(0, Math.min(100, meter)) : null
  const meterTone = meterPct != null
    ? (meterPct >= 90 ? 'bg-red-400/80' : meterPct >= 75 ? 'bg-amber-400/80' : 'bg-blue-500')
    : ''
  return (
    <Card spotlight className="relative p-5 card-lift hover:border-white/20 flex flex-col justify-between" {...rest}>
      {flashKey && <span key={flashKey} className="stat-flash-overlay" />}
      <div>
        <div className="flex items-start justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-white/5 border border-white/[0.06] flex items-center justify-center shrink-0 text-gray-400">
              {icon}
            </span>
            <span className="text-xs font-medium text-gray-500 truncate">{label}</span>
          </div>
          {action}
        </div>
        <div className="flex items-baseline gap-2">
          {loading ? (
            <span className="skeleton block h-7 w-24 my-0.5" />
          ) : (
            <p className="text-2xl font-bold text-white tracking-tight tabular-nums">
              {numeric ? <AnimatedNumber value={value} format={format} /> : value}
            </p>
          )}
          {trend && <TrendPill {...trend} />}
        </div>
        {sub && <p className="text-xs text-gray-500 mt-1 truncate">{sub}</p>}
      </div>
      {meterPct != null && (
        <div className="mt-3 h-1 rounded-full bg-white/8 overflow-hidden">
          <div className={`h-full rounded-full bar-fill ${meterTone}`} style={{ width: `${meterPct}%` }} />
        </div>
      )}
    </Card>
  )
}
