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

function ThemeCard({ t, active, onSelect }) {
  const isRetro = t.id === 'retro'
  const isMario = t.id === 'mario'
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
      {isMario ? (
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
