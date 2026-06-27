import { THEMES } from '../hooks/useTheme'

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
          <span>SimpDash</span>
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

// A tiny Pip-Boy screen (phosphor green on black + scanlines) for the Fallout
// theme preview. Inline-styled so it always reads Fallout regardless of theme.
function FalloutPreview() {
  const pip = '#1aff40'
  return (
    <div className="h-24 relative overflow-hidden p-2"
      style={{ background: '#020a02', color: pip, fontFamily: "'Courier New', monospace",
        textShadow: '0 0 4px rgba(26,255,64,0.6)', fontSize: 10, letterSpacing: 1 }}>
      <div className="flex justify-between font-bold">
        <span>STAT</span><span>HP 348/450</span>
      </div>
      <div className="mt-1.5 h-2 w-full" style={{ border: `1px solid ${pip}` }}>
        <div className="h-full" style={{ width: '77%', background: pip }} />
      </div>
      <div className="mt-2 text-[16px] font-bold tracking-widest">VAULT-TEC</div>
      {/* scanlines */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0) 50%, rgba(0,0,0,0.3) 50%)', backgroundSize: '100% 3px' }} />
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

function ThemeCard({ t, active, onSelect }) {
  const isRetro = t.id === 'retro'
  const isMario = t.id === 'mario'
  const isWin98 = t.id === 'win98'
  const isFallout = t.id === 'fallout'
  const isGlass = t.id === 'glass'
  return (
    <div
      className={`bg-[#13131e] border rounded-2xl p-5 flex flex-col gap-4 transition-colors cursor-pointer ${
        active
          ? 'border-white/30 ring-1 ring-white/20'
          : 'border-white/[0.07] hover:border-white/20'
      }`}
      onClick={() => onSelect(t.id)}
    >
      {/* Mini preview */}
      {isGlass ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <GlassPreview />
        </div>
      ) : isFallout ? (
        <div className="rounded-xl overflow-hidden border border-white/10">
          <FalloutPreview />
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
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium shrink-0">
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
  )
}

export default function Themes({ theme, setTheme }) {
  return (
    <main className="p-8 max-w-3xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {THEMES.map(t => (
          <ThemeCard key={t.id} t={t} active={theme === t.id} onSelect={setTheme} />
        ))}
      </div>
    </main>
  )
}
