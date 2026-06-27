import { useState } from 'react'
import { setupPassword } from '../lib/api'
import logo from '../../assets/superdashlogo.png'

export default function SetupPassword({ onDone }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) return setError('Password must be at least 8 characters')
    if (pw !== confirm) return setError('Passwords do not match')
    setLoading(true)
    setError('')
    try {
      await setupPassword(pw)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0c0c14] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8">
          <img src={logo} alt="SuperDash" className="w-8 h-8 rounded-lg object-contain" />
          <span className="font-semibold text-white">SuperDash</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">Set up your dashboard</h1>
        <p className="text-gray-500 mb-7 text-sm">Choose an admin password to get started.</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="w-full bg-[#13131e] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-600 text-sm transition-colors"
            autoFocus
            required
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="w-full bg-[#13131e] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-600 text-sm transition-colors"
            required
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? 'Setting up…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  )
}
