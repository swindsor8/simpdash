import { useRef } from 'react'
import { THEMES } from '../hooks/useTheme'
import { useCardSpotlight, usePopPulse, useScrollReveal } from './motion'
import { TiltedCard } from './ReactBits'
import { SUPERDASH_MARK_PATH } from './ShapeMagicLogo'

// The Switch widget from the design brief — used as the live toggle for the
// retro theme. Colours are the retro palette itself (#121331, #f24c00, #ebe6ef).
function RetroSwitch({ active, onToggle }) {
  return (
    <div
      className={`w-40 aspect-video rounded-xl border-4 border-[#121331] transition-colors duration-300 cursor-pointer select-none ${active ? 'bg-[#3a3347]' : 'bg-[#ebe6ef]'}`}
      onClick={onToggle}
      title={active ? 'Switch to Midnight' : 'Switch to Retro'}
    >
      <div className="flex h-full w-full px-2 items-center gap-x-2">
        <div className="w-5 h-5 flex-shrink-0 rounded-full border-4 border-[#121331]" />
        <div className={`transition-transform duration-300 w-full h-9 border-4 border-[#121331] rounded relative overflow-hidden ${active ? 'scale-x-[-1]' : ''}`}>
          <div className="w-full h-full bg-[#f24c00]">
            <div className="w-0 h-0 z-20 border-l-[20px] border-l-transparent border-r-[20px] border-r-transparent border-t-[16px] border-t-[#121331] relative">
              <div className="w-0 h-0 absolute border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[12px] border-t-[#e44901] -top-4 -left-[15px]" />
            </div>
            <div className="w-[20px] h-8 z-10 absolute top-[8px] left-0 bg-[#f24c00] border-r-2 border-b-4 border-[#121331] transform skew-y-[39deg]" />
            <div className="w-[21px] h-8 z-10 absolute top-[8px] left-[20px] bg-[#c44002] border-r-4 border-l-2 border-b-4 border-[#121331] transform skew-y-[-39deg]" />
          </div>
        </div>
        <div className="w-5 h-1 flex-shrink-0 bg-[#121331] rounded-full" />
      </div>
    </div>
  )
}

// Mario pixel-art sprite (brick + ?-block + hidden mushroom). Hovering the
// block pops the mushroom up — styling lives in index.css under .mario-sprite.
function MarioSprite() {
  return (
    <div className="mario-sprite-wrap">
      <div className="mario-sprite">
        <div className="brick one" />
        <div className="tooltip-mario-container">
          <div className="box" />
          <div className="mush" />
        </div>
        <div className="brick two" />
      </div>
    </div>
  )
}

// A tiny Win98 dialog window (navy title bar + raised silver body + OK button)
// rendered with inline bevels so it always shows Win98 regardless of active theme.
function Win98Preview() {
  const raised = 'inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #dfdfdf'
  const tahoma = "'Tahoma', 'MS Sans Serif', system-ui, sans-serif"
  return (
    <div className="h-24 flex items-center justify-center" style={{ background: '#008080' }}>
      <div style={{ background: '#c0c0c0', boxShadow: raised, width: 150, fontFamily: tahoma }}>
        <div className="flex items-center justify-between px-1 py-0.5"
          style={{ background: '#000080', color: '#fff', fontSize: 11, fontWeight: 700 }}>
          <span>SuperDash</span>
          <span className="px-1 leading-none"
            style={{ background: '#c0c0c0', color: '#000', boxShadow: raised, fontSize: 10 }}>×</span>
        </div>
        <div className="px-2 py-2.5 flex flex-col items-center gap-2" style={{ color: '#000', fontSize: 11 }}>
          <span>Ready.</span>
          <button className="px-3 py-0.5" style={{ background: '#c0c0c0', boxShadow: raised, fontSize: 11 }}>OK</button>
        </div>
      </div>
    </div>
  )
}

// A live animated mini Fallout-4 CRT screen (phosphor green on black + rolling
// scan beam + blinking cursor + HUD brackets) for the Terminal theme preview.
function TerminalPreview() {
  const pip = '#1aff40'
  return (
    <div className="terminal-preview h-24 relative overflow-hidden p-2.5 select-none"
      style={{ background: '#020a02', color: pip, fontFamily: "'Share Tech Mono', 'Courier New', monospace",
        textShadow: '0 0 5px rgba(26,255,64,0.65)', fontSize: 10, letterSpacing: 1 }}>
      {/* Rolling phosphor V-Sync refresh beam */}
      <div className="terminal-preview-beam" />
      <div className="relative z-10 flex justify-between font-bold">
        <span>ROBCO // NODE</span><span>CPU 34%</span>
      </div>
      <div className="relative z-10 mt-1.5 h-2 w-full p-[1px]" style={{ border: `1px solid ${pip}` }}>
        <div className="terminal-preview-bar h-full" style={{ width: '77%', background: pip, boxShadow: '0 0 6px rgba(26,255,64,0.75)' }} />
      </div>
      <div className="relative z-10 mt-2 text-[15px] font-bold tracking-widest flex items-center gap-1">
        <span>TERMINAL OS</span>
        <span className="terminal-preview-cursor inline-block w-2 h-3.5" style={{ background: pip }} />
      </div>
      {/* scanlines */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.32) 50%)', backgroundSize: '100% 3px' }} />
    </div>
  )
}

// A frosted glass chip over a mini aurora for the Liquid Glass preview.
// Inline-styled so it always reads "glass" regardless of the active theme.
function GlassPreview() {
  return (
    <div className="h-24 flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg,#2a1758,#14306e,#0c5d57,#5e1f6e)' }}>
      <div className="px-6 py-3 rounded-2xl text-white text-xs font-semibold"
        style={{
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(6px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(6px) saturate(1.6)',
          boxShadow: 'inset 2px 2px 1px -1px rgba(255,255,255,0.6), inset -1px -1px 1px 1px rgba(255,255,255,0.35), 0 6px 16px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.22)',
        }}>
        Liquid Glass
      </div>
    </div>
  )
}

// Live animated mini plasma-beams + elastic orbital gauge preview for Kinetic.
// Self-contained styling so it always reads "Kinetic" regardless of active theme.
function KineticPreview() {
  return (
    <div className="kinetic-preview h-24 relative overflow-hidden flex items-center justify-between px-4 select-none"
      style={{ background: '#05040d' }}>
      {/* Animated diagonal plasma beams */}
      <div className="kinetic-preview-beam a" />
      <div className="kinetic-preview-beam b" />
      <div className="kinetic-preview-beam c" />

      {/* Micro dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(167,139,250,0.22) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }} />

      {/* Left: iridescent typography + pill */}
      <div className="relative z-10 flex flex-col gap-1">
        <span className="kinetic-preview-title text-sm font-bold tracking-wider uppercase"
          style={{ fontFamily: "'Space Grotesk', 'Plus Jakarta Sans', sans-serif" }}>
          KINETIC
        </span>
        <span className="inline-flex items-center gap-1.5 text-[9px] font-mono px-2 py-0.5 rounded-full w-fit"
          style={{
            background: 'rgba(13,11,28,0.75)',
            border: '1px solid rgba(0,240,255,0.45)',
            color: '#7af8ff',
            boxShadow: '0 0 12px rgba(0,240,255,0.22)',
          }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#ff2e97', boxShadow: '0 0 6px #ff2e97' }} />
          GSAP · BITS
        </span>
      </div>

      {/* Right: animated orbiting plasma gauge ring */}
      <div className="relative z-10 w-12 h-12 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 56 56" className="w-full h-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="kp-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="50%" stopColor="#ff2e97" />
              <stop offset="100%" stopColor="#00f0ff" />
            </linearGradient>
          </defs>
          <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(167,139,250,0.24)" strokeWidth="1" strokeDasharray="3 4" className="kinetic-preview-orbit" />
          <circle cx="28" cy="28" r="19" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle cx="28" cy="28" r="19" fill="none" stroke="url(#kp-grad)" strokeWidth="4" strokeLinecap="round"
            strokeDasharray="86 120" className="kinetic-preview-arc" />
        </svg>
        <span className="absolute text-[9px] font-mono font-bold" style={{ color: '#e9e5ff' }}>FX</span>
      </div>
    </div>
  )
}

// Brand preview shared by Nocturne (dark) and Midnight (light): the indigo→teal
// corner glows, a gradient logo pip and a gradient accent bar. Inline-styled
// with a per-theme palette so each reads accurately.
const BRAND_PALETTES = {
  nocturne: { canvas: '#09090e', panel: 'rgba(255,255,255,0.02)', card: '#141420',
    cardBorder: 'rgba(255,255,255,0.08)', bar: 'rgba(255,255,255,0.10)',
    glowA: 'rgba(155,153,254,0.22)', glowB: 'rgba(43,200,183,0.18)' },
  default: { canvas: '#f5f6fb', panel: '#ffffff', card: '#ffffff',
    cardBorder: 'rgba(20,22,45,0.10)', bar: 'rgba(20,22,45,0.10)',
    glowA: 'rgba(124,122,246,0.20)', glowB: 'rgba(20,184,166,0.18)' },
}
function BrandPreview({ id }) {
  const p = BRAND_PALETTES[id]
  return (
    <div className="h-24 relative overflow-hidden flex" style={{ background: p.canvas }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          `radial-gradient(60% 50% at 92% 0%, ${p.glowA}, transparent 60%),` +
          `radial-gradient(55% 50% at 0% 100%, ${p.glowB}, transparent 60%)`,
      }} />
      <div className="w-9 shrink-0 relative flex flex-col gap-1.5 p-1.5 pt-2" style={{ background: p.panel }}>
        <svg viewBox="0 0 512 512" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
          <defs>
            <linearGradient id={`bp-mark-${id}`} x1="88" y1="60" x2="432" y2="460" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="40%" stopColor="#9B99FE" />
              <stop offset="100%" stopColor="#2BC8B7" />
            </linearGradient>
          </defs>
          <path d={SUPERDASH_MARK_PATH} fill={`url(#bp-mark-${id})`} />
        </svg>
        <div className="h-1.5 w-6 rounded-full" style={{ background: p.bar }} />
        <div className="h-1.5 w-5 rounded-full" style={{ background: p.bar }} />
      </div>
      <div className="flex-1 relative p-2 flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <div className="h-8 flex-1 rounded-lg" style={{ background: p.card, border: `1px solid ${p.cardBorder}` }} />
          <div className="h-8 flex-1 rounded-lg" style={{ background: p.card, border: `1px solid ${p.cardBorder}` }} />
        </div>
        <div className="h-5 w-20 rounded-lg" style={{ background: 'linear-gradient(135deg,#4f46e5,#0d9488)' }} />
      </div>
    </div>
  )
}

function ThemeCard({ t, active, activeTheme, onSelect }) {
  const cardRef = useRef(null)
  const badgeRef = useRef(null)
  useCardSpotlight(cardRef)
  usePopPulse(badgeRef, active)
  const isBrand = t.id === 'nocturne' || t.id === 'default'
  const isRetro = t.id === 'retro'
  const isMario = t.id === 'mario'
  const isWin98 = t.id === 'win98'
  const isTerminal = t.id === 'terminal'
  const isGlass = t.id === 'glass'
  const isKinetic = t.id === 'kinetic'
  return (
    <TiltedCard theme={activeTheme} maxTilt={4} className="h-full">
    <div
      ref={cardRef}
      data-reveal=""
      className={`h-full bg-[#13131e] border rounded-2xl p-5 flex flex-col gap-4 transition-colors cursor-pointer card-lift card-spot ${
        active
          ? 'border-white/30 ring-1 ring-white/20'
          : 'border-white/[0.07] hover:border-white/20'
      }`}
      onClick={() => onSelect(t.id)}
    >
      {/* Mini preview */}
      {isBrand ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <BrandPreview id={t.id} />
        </div>
      ) : isKinetic ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <KineticPreview />
        </div>
      ) : isGlass ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <GlassPreview />
        </div>
      ) : isTerminal ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <TerminalPreview />
        </div>
      ) : isWin98 ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <Win98Preview />
        </div>
      ) : isMario ? (
        <div className="rounded-xl overflow-hidden border border-white/10 bg-[#5c94fc]" title="Hover the block!">
          <MarioSprite />
        </div>
      ) : isRetro ? (
        <div className="flex justify-center py-1">
          <RetroSwitch active={active} onToggle={() => onSelect(t.id)} />
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-white/10 h-24 flex">
          {/* Sidebar strip */}
          <div className="w-10 bg-[#101018] shrink-0 flex flex-col gap-1.5 p-1.5 pt-2">
            <div className="h-1.5 rounded-full bg-white/20 w-4" />
            <div className="h-1.5 rounded-full bg-blue-600/60 w-6" />
            <div className="h-1.5 rounded-full bg-white/10 w-5" />
            <div className="h-1.5 rounded-full bg-white/10 w-4" />
          </div>
          {/* Content */}
          <div className="flex-1 bg-[#0c0c14] p-2 flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <div className="h-8 flex-1 rounded-lg bg-[#13131e]" />
              <div className="h-8 flex-1 rounded-lg bg-[#13131e]" />
            </div>
            <div className="h-8 rounded-lg bg-[#13131e] w-full" />
          </div>
        </div>
      )}

      {/* Label row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{t.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
        </div>
        {active && (
          <span ref={badgeRef} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium shrink-0">
            Active
          </span>
        )}
      </div>

      {!active && (
        <button
          className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors self-start"
          onClick={e => { e.stopPropagation(); onSelect(t.id) }}
        >
          Apply
        </button>
      )}
    </div>
    </TiltedCard>
  )
}

export default function Themes({ theme, setTheme, embedded = false }) {
  const gridRef = useRef(null)
  useScrollReveal(gridRef, { theme })
  const grid = (
    <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {THEMES.map(t => (
        <ThemeCard key={t.id} t={t} active={theme === t.id} activeTheme={theme} onSelect={setTheme} />
      ))}
    </div>
  )
  if (embedded) return grid // rendered inside the Settings page
  return <main className="p-4 sm:p-8 max-w-3xl">{grid}</main>
}
