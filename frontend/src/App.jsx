import { useState, useEffect } from 'react'
import SetupPassword from './components/SetupPassword'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import BootSequence from './components/BootSequence'
import { getSetupStatus, getMe } from './lib/api'
import { useTheme } from './hooks/useTheme'
import { loadingText } from './lib/copy'

export default function App() {
  const { theme, setTheme } = useTheme()
  const [screen, setScreen] = useState('loading')

  useEffect(() => {
    getSetupStatus()
      .then(({ onboarded }) => {
        if (!onboarded) return setScreen('setup')
        getMe().then(ok => setScreen(ok ? 'dashboard' : 'login'))
      })
      .catch(() => setScreen('login'))
  }, [])

  let screenEl
  if (screen === 'loading') {
    screenEl = (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-600 text-sm">{loadingText('Loading…')}</span>
      </div>
    )
  } else if (screen === 'setup') {
    screenEl = <SetupPassword onDone={() => setScreen('login')} />
  } else if (screen === 'login') {
    screenEl = <Login onDone={() => setScreen('dashboard')} />
  } else {
    screenEl = <Dashboard onLogout={() => setScreen('login')} theme={theme} setTheme={setTheme} />
  }

  return (
    <>
      {screenEl}
      <BootSequence theme={theme} />
    </>
  )
}
