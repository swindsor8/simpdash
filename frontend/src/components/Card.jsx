// Shared dashboard card chrome + status primitives.
//
// IMPORTANT: every surface here emits the literal classes the theme system keys
// on — `bg-[#13131e]` + `rounded-2xl` for the card, and `text-emerald/amber/red-400`
// + `bg-white/8` for pills. The 5 alternate themes (retro/mario/win98/fallout/
// glass) override those class names by name in index.css, so reusing them keeps
// every theme working with zero extra CSS. Don't swap in raw hex or new colors.

import { AnimatedNumber, useChangeFlash } from './motion'

// Card — the one elevated dark surface used across the dashboard. Pass
// icon/title/subtitle/action to get the standard header row; omit them and it's
// just chrome around `children` (used by the bespoke node/guest cards).
export function Card({ icon, title, subtitle, action, className = '', onClick, children }) {
  const titled = title || action
  return (
    <div onClick={onClick} className={`bg-[#13131e] border border-white/[0.07] rounded-2xl ${className}`}>
      {titled && (
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-gray-500 shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
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
  neutral: 'bg-white/8 text-gray-400',
}

// StatusPill — soft tinted badge for any status/outcome. AA-contrast on the dark
// card surface (emerald-400 ~7:1, amber-400 ~9:1, red-400 ~6:1, gray-400 ~6:1).
export function StatusPill({ variant = 'neutral', className = '', title, children }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${PILL[variant]} ${className}`}>
      {children}
    </span>
  )
}

// statusVariant maps a Proxmox running/online string to a pill variant.
export const statusVariant = (s) => (s === 'running' || s === 'online' ? 'success' : 'neutral')

// TrendPill — up/down % vs a prior period. Rendered by StatCard ONLY when given
// real comparison data; SuperDash has no historical metrics yet, so nothing
// passes `trend` today. Kept here so adding history later is a one-prop change,
// never a fabricated number. (See acceptance note in the task brief.)
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

// StatCard — icon+label header (optional kebab `action`), large number, optional
// sub line, optional trend pill. Dark surface, not the old light-pastel tiles.
// A numeric `value` tweens between values (--motion-medium) and flashes the card
// on change; a string `value` (e.g. "3 / 4") renders as-is. `format` styles the
// tweened number; `loading` shows a shimmer skeleton before the first frame.
export function StatCard({ icon, label, value, format, sub, trend, action, loading }) {
  const numeric = typeof value === 'number'
  const flashKey = useChangeFlash(numeric ? value : null)
  return (
    <Card className="relative p-5 card-lift hover:border-white/20">
      {flashKey && <span key={flashKey} className="stat-flash-overlay" />}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-gray-500">{icon}</span>
          <span className="text-xs font-medium text-gray-500 truncate">{label}</span>
        </div>
        {action}
      </div>
      <div className="flex items-end gap-2">
        {loading ? (
          <span className="skeleton block h-7 w-20 my-0.5" />
        ) : (
          <p className="text-2xl font-bold text-white tabular-nums">
            {numeric ? <AnimatedNumber value={value} format={format} /> : value}
          </p>
        )}
        {trend && <TrendPill {...trend} />}
      </div>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </Card>
  )
}
