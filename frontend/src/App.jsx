import { useState, useEffect, lazy, Suspense } from 'react'
import SetupPassword from './components/SetupPassword'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import BootSequence from './components/BootSequence'
import { ShapeMagicLogo } from './components/ShapeMagicLogo'
import { getSetupStatus, getMe } from './lib/api'
import { useTheme } from './hooks/useTheme'
import { loadingText } from './lib/copy'

const KineticStage = lazy(() => import('./components/KineticStage'))
const TerminalStage = lazy(() => import('./components/TerminalStage'))

export default function App() {
  const { theme, setTheme } = useTheme()
  const [screen, setScreen] = useState('loading')
  const [pveLocal, setPveLocal] = useState(true)

  const handleSetTheme = (next) => {
    if (next === 'kinetic' && theme !== 'kinetic') {
      sessionStorage.removeItem('sd-kinetic-ignited')
      sessionStorage.setItem('sd-kinetic-switched', '1')
    }
    if (next === 'terminal' && theme !== 'terminal') {
      sessionStorage.setItem('sd-terminal-switched', '1')
    }
    setTheme(next)
  }

  useEffect(() => {
    getSetupStatus()
      .then(({ onboarded, pve_local }) => {
        if (typeof pve_local === 'boolean') setPveLocal(pve_local)
        if (!onboarded) return setScreen('setup')
        getMe().then(ok => setScreen(ok ? 'dashboard' : 'login'))
      })
      .catch(() => setScreen('login'))
  }, [])

  let screenEl
  if (screen === 'loading') {
    screenEl = (
      <div className="min-h-screen bg-[#0c0c14] flex flex-col items-center justify-center gap-4">
        <ShapeMagicLogo size={52} theme={theme} glow />
        <span className="text-gray-500 text-xs font-mono tracking-wider uppercase">{loadingText('Loading…')}</span>
      </div>
    )
  } else if (screen === 'setup') {
    screenEl = <SetupPassword pveLocal={pveLocal} theme={theme} onDone={() => setScreen('login')} />
  } else if (screen === 'login') {
    screenEl = <Login theme={theme} onDone={() => setScreen('dashboard')} />
  } else {
    screenEl = <Dashboard onLogout={() => setScreen('login')} theme={theme} setTheme={handleSetTheme} />
  }

  return (
    <>
      {theme === 'kinetic' && (
        <Suspense fallback={null}>
          <KineticStage theme={theme} />
        </Suspense>
      )}
      {theme === 'terminal' && (
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="crt-stage-frame fixed pointer-events-none z-0"
              style={{ backgroundColor: '#020a02' }}
            />
          }
        >
          <TerminalStage theme={theme} />
        </Suspense>
      )}
      {screenEl}
      <BootSequence theme={theme} />
    </>
  )
}
