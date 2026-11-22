import { useState, useRef } from 'react'
import { login } from '../lib/api'
import { Card } from './Card'
import { useStaggerMount } from './motion'
import { ThemedHeading, Magnet, InteractiveGridBg } from './ReactBits'
import { BrandLockup } from './ShapeMagicLogo'

export default function Login({ theme, onDone }) {
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const formWrapRef = useRef(null)
  useStaggerMount(formWrapRef, '[data-stagger]', { theme, deps: [needCode] })

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await login(pw, needCode ? code.trim() : undefined)
      if (res?.totp_required) {
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
    <div className="relative min-h-screen bg-[#0c0c14] flex items-center justify-center p-4 overflow-hidden">
      <InteractiveGridBg theme={theme} />

      <div ref={formWrapRef} className="relative z-10 w-full max-w-sm">
        <Card spotlight className="p-7 sm:p-8 shadow-2xl">
          <div data-stagger="" className="mb-7">
            <BrandLockup size="lg" theme={theme} subtitle="PROXMOX VE" interactive />
          </div>

          <h1 data-stagger="" className="text-2xl font-bold text-white tracking-tight mb-1.5">
            <ThemedHeading text={needCode ? 'Two-factor code' : 'Welcome back'} theme={theme} />
          </h1>
          <p data-stagger="" className="text-gray-500 mb-6 text-sm leading-relaxed">
            {needCode
              ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
              : 'Sign in with your admin password to access your cluster.'}
          </p>

          <form data-stagger="" onSubmit={submit} className="space-y-3.5">
            {!needCode ? (
              <input
                type="password"
                placeholder="Admin password"
                value={pw}
                onChange={e => setPw(e.target.value)}
                className="w-full bg-[#0c0c14] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-500 text-sm transition-colors"
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
                className="w-full bg-[#0c0c14] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-500 text-sm font-mono tracking-widest transition-colors"
                autoFocus
                required
              />
            )}
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <Magnet strength={0.08} className="block w-full" theme={theme}>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
              >
                {loading ? 'Signing in…' : needCode ? 'Verify' : 'Sign in'}
              </button>
            </Magnet>
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
        </Card>
      </div>
    </div>
  )
}
