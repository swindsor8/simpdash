import { useState, useEffect } from 'react'
import SetupPassword from './components/SetupPassword'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import { getSetupStatus, getMe } from './lib/api'
import { useTheme } from './hooks/useTheme'

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

  if (screen === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-600 text-sm">Loading…</span>
      </div>
    )
  }
  if (screen === 'setup') return <SetupPassword onDone={() => setScreen('login')} />
  if (screen === 'login') return <Login onDone={() => setScreen('dashboard')} />
  return <Dashboard onLogout={() => setScreen('login')} theme={theme} setTheme={setTheme} />
}
