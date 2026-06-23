import { useState } from 'react'
import { setupPassword } from '../lib/api'

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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-white mb-1">SimpDash</h1>
        <p className="text-gray-500 mb-8 text-sm">Set an admin password to get started.</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className="w-full bg-gray-900 text-white border border-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 placeholder-gray-600 text-sm"
            autoFocus
            required
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="w-full bg-gray-900 text-white border border-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 placeholder-gray-600 text-sm"
            required
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Setting up…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  )
}
