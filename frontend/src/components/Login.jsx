import { useState } from 'react'
import { login } from '../lib/api'
import logo from '../../assets/logo.png'

export default function Login({ onDone }) {
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await login(pw, needCode ? code.trim() : undefined)
      if (res?.totp_required) {
        // Password accepted — step up to the second factor.
        setNeedCode(true)
        return
      }
      onDone()
    } catch (err) {
      setError(err.message || (needCode ? 'Invalid code' : 'Invalid password'))
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
        <h1 className="text-2xl font-bold text-white mb-1">
          {needCode ? 'Two-factor code' : 'Welcome back'}
        </h1>
        <p className="text-gray-500 mb-7 text-sm">
          {needCode
            ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
            : 'Enter your password to continue.'}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {!needCode ? (
            <input
              type="password"
              placeholder="Password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              className="w-full bg-[#13131e] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-600 text-sm transition-colors"
              autoFocus
              required
            />
          ) : (
            <input
              placeholder="123456 or ABCDE-FGHJK"
              value={code}
              onChange={e => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full bg-[#13131e] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-600 text-sm font-mono tracking-widest transition-colors"
              autoFocus
              required
            />
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? 'Signing in…' : needCode ? 'Verify' : 'Sign in'}
          </button>
          {needCode && (
            <button
              type="button"
              onClick={() => { setNeedCode(false); setCode(''); setError('') }}
              className="w-full text-gray-500 hover:text-gray-300 text-xs py-1 transition-colors"
            >
              ← Back to password
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
