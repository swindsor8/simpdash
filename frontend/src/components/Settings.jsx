import { useState, useEffect } from 'react'
import {
  getSettings, putNotifySettings, testNotify, putPBSSettings,
  twoFASetup, twoFAEnable, twoFADisable,
} from '../lib/api'

const inputCls = 'w-full bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-700 focus:outline-none focus:border-blue-500/50'
const labelCls = 'block text-xs text-gray-500 mb-1.5'
const btnPrimary = 'text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40'
const btnGhost = 'text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40'

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-white mb-1">{title}</h2>
      <p className="text-xs text-gray-500 mb-5">{subtitle}</p>
      {children}
    </div>
  )
}

function Msg({ msg }) {
  if (!msg) return null
  return <p className={`text-xs mt-3 ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
}

// --- Notifications ---

const PROVIDERS = [
  { id: 'ntfy', label: 'ntfy', hint: 'URL is your topic, e.g. https://ntfy.sh/my-homelab' },
  { id: 'gotify', label: 'Gotify', hint: 'URL is your server root; token is an application token' },
  { id: 'discord', label: 'Discord', hint: 'URL is a channel webhook URL' },
  { id: 'webhook', label: 'Webhook', hint: 'Generic JSON POST { title, message, source, ts }' },
]

const EVENTS = [
  ['job_failed', 'A dashboard job (update / script install) fails'],
  ['node_offline', 'A Proxmox node goes offline (and comes back)'],
  ['updates_available', 'apt updates are available (daily digest)'],
  ['backup_failed', 'A vzdump backup job fails'],
]

function NotifySection({ initial }) {
  const [form, setForm] = useState({
    provider: initial.provider || 'ntfy',
    url: initial.url || '',
    token: '',
    insecure: !!initial.insecure,
    job_failed: !!initial.job_failed,
    node_offline: !!initial.node_offline,
    updates_available: !!initial.updates_available,
    backup_failed: !!initial.backup_failed,
  })
  const [hasToken, setHasToken] = useState(!!initial.has_token)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const provider = PROVIDERS.find(p => p.id === form.provider)

  async function save() {
    setBusy(true); setMsg(null)
    try {
      // Empty token field keeps the stored token; the backend treats "-" as clear.
      await putNotifySettings({ ...form, token: form.token === '' ? null : form.token })
      if (form.token && form.token !== '-') setHasToken(true)
      if (form.token === '-') setHasToken(false)
      set('token', '')
      setMsg({ ok: true, text: form.url ? 'Saved.' : 'Notifications disabled.' })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setMsg(null)
    try {
      await testNotify()
      setMsg({ ok: true, text: 'Test notification sent — check your device.' })
    } catch (e) { setMsg({ ok: false, text: `Test failed: ${e.message}` }) }
    finally { setBusy(false) }
  }

  return (
    <Section title="Notifications" subtitle="Push alerts to ntfy, Gotify, Discord, or any webhook when something needs attention.">
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <label>
          <span className={labelCls}>Provider</span>
          <select value={form.provider} onChange={e => set('provider', e.target.value)} className={inputCls}>
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>URL <span className="text-gray-700">— empty disables</span></span>
          <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://ntfy.sh/my-topic" className={inputCls} />
        </label>
      </div>
      <p className="text-[11px] text-gray-600 mb-4">{provider?.hint}</p>
      {form.provider !== 'discord' && (
        <label className="block mb-4">
          <span className={labelCls}>
            Token {hasToken ? <span className="text-emerald-500">— stored</span> : <span className="text-gray-700">— optional</span>}
          </span>
          <input
            type="password"
            value={form.token}
            onChange={e => set('token', e.target.value)}
            placeholder={hasToken ? 'Leave empty to keep, "-" to clear' : 'Access / app token'}
            className={inputCls}
            autoComplete="off"
          />
        </label>
      )}
      <div className="space-y-2 mb-4">
        {EVENTS.map(([key, desc]) => (
          <label key={key} className="flex items-center gap-2.5 text-sm text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} className="accent-blue-500" />
            {desc}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2.5 text-xs text-gray-600 cursor-pointer select-none mb-5">
        <input type="checkbox" checked={form.insecure} onChange={e => set('insecure', e.target.checked)} className="accent-blue-500" />
        Skip TLS verification (self-hosted server with a self-signed certificate)
      </label>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className={btnPrimary}>Save</button>
        <button onClick={test} disabled={busy} className={btnGhost}>Send test</button>
      </div>
      <Msg msg={msg} />
    </Section>
  )
}

// --- Two-factor auth ---

function TwoFASection({ initial }) {
  const [enabled, setEnabled] = useState(!!initial.enabled)
  const [recoveryLeft, setRecoveryLeft] = useState(initial.recovery_codes ?? 0)
  const [setup, setSetup] = useState(null)       // { secret, otpauth_uri }
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(null) // codes shown once after enable
  const [disableForm, setDisableForm] = useState(null) // { password, code }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function begin() {
    setBusy(true); setMsg(null)
    try { setSetup(await twoFASetup()) }
    catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  async function enable() {
    setBusy(true); setMsg(null)
    try {
      const res = await twoFAEnable(code.trim())
      setEnabled(true)
      setSetup(null)
      setCode('')
      setRecovery(res.recovery_codes)
      setRecoveryLeft(res.recovery_codes.length)
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setMsg(null)
    try {
      await twoFADisable(disableForm.password, disableForm.code.trim())
      setEnabled(false)
      setDisableForm(null)
      setRecovery(null)
      setMsg({ ok: true, text: 'Two-factor authentication disabled.' })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <Section
      title="Two-factor authentication"
      subtitle="Require a one-time code from an authenticator app (or a recovery code) at sign-in."
    >
      {!enabled && !setup && (
        <button onClick={begin} disabled={busy} className={btnPrimary}>Set up 2FA</button>
      )}

      {setup && (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-300 mb-2">
              1. In your authenticator app (Aegis, Google Authenticator, 1Password…), add an account
              by <span className="text-white font-medium">entering this key manually</span>:
            </p>
            <code className="block bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-emerald-300 font-mono tracking-wider break-all select-all">
              {setup.secret}
            </code>
            <p className="text-[11px] text-gray-600 mt-1.5">
              Type: time-based (TOTP) · 6 digits · 30 s. On this device? <a className="text-blue-400 hover:underline" href={setup.otpauth_uri}>open in authenticator</a>.
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-300 mb-2">2. Enter the 6-digit code it shows to confirm:</p>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && code.trim().length === 6) enable() }}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                className={`${inputCls} w-32 font-mono tracking-widest text-center`}
                autoFocus
              />
              <button onClick={enable} disabled={busy || code.trim().length !== 6} className={btnPrimary}>Enable</button>
              <button onClick={() => { setSetup(null); setCode('') }} className={btnGhost}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {recovery && (
        <div className="mt-4 bg-amber-500/10 border border-amber-500/25 rounded-xl p-4">
          <p className="text-sm text-amber-300 font-medium mb-2">
            Save these recovery codes now — they are shown only once.
          </p>
          <p className="text-xs text-amber-400/70 mb-3">
            Each works exactly once if you lose your authenticator. Store them somewhere safe (password manager, printed).
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-amber-200 select-all">
            {recovery.map(c => <span key={c}>{c}</span>)}
          </div>
        </div>
      )}

      {enabled && !recovery && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Enabled · {recoveryLeft} recovery code{recoveryLeft !== 1 ? 's' : ''} left
          </span>
          {!disableForm && (
            <button onClick={() => setDisableForm({ password: '', code: '' })} className={btnGhost}>Disable…</button>
          )}
        </div>
      )}

      {enabled && disableForm && (
        <div className="mt-4 space-y-3 max-w-sm">
          <p className="text-xs text-gray-500">Disabling requires your password and a current code — both factors.</p>
          <input
            type="password" placeholder="Password" autoComplete="current-password"
            value={disableForm.password}
            onChange={e => setDisableForm(f => ({ ...f, password: e.target.value }))}
            className={inputCls}
          />
          <input
            placeholder="6-digit or recovery code"
            value={disableForm.code}
            onChange={e => setDisableForm(f => ({ ...f, code: e.target.value }))}
            className={`${inputCls} font-mono`}
          />
          <div className="flex gap-2">
            <button
              onClick={disable}
              disabled={busy || !disableForm.password || !disableForm.code}
              className="text-xs px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-40"
            >
              Disable 2FA
            </button>
            <button onClick={() => setDisableForm(null)} className={btnGhost}>Cancel</button>
          </div>
        </div>
      )}
      <Msg msg={msg} />
    </Section>
  )
}

// --- Proxmox Backup Server ---

function PBSSection({ initial }) {
  const [form, setForm] = useState({
    url: initial.url || '',
    token_id: initial.token_id || '',
    secret: '',
    fingerprint: initial.fingerprint || '',
  })
  const [hasSecret, setHasSecret] = useState(!!initial.has_secret)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setBusy(true); setMsg(null)
    try {
      await putPBSSettings({ ...form, secret: form.secret === '' ? null : form.secret })
      if (form.secret && form.secret !== '-') setHasSecret(true)
      setMsg({ ok: true, text: form.url ? 'Saved — the Backups tab now shows PBS data.' : 'PBS integration disabled.' })
      set('secret', '')
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <Section
      title="Proxmox Backup Server"
      subtitle="Optional: show PBS datastore usage and per-guest verification state in the Backups tab."
    >
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <label>
          <span className={labelCls}>URL <span className="text-gray-700">— empty disables</span></span>
          <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://192.168.1.30:8007" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>API token ID</span>
          <input value={form.token_id} onChange={e => set('token_id', e.target.value)} placeholder="superdash@pbs!dash" className={`${inputCls} font-mono`} />
        </label>
        <label>
          <span className={labelCls}>
            Token secret {hasSecret ? <span className="text-emerald-500">— stored</span> : ''}
          </span>
          <input
            type="password" autoComplete="off"
            value={form.secret} onChange={e => set('secret', e.target.value)}
            placeholder={hasSecret ? 'Leave empty to keep' : 'uuid secret'} className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>Certificate fingerprint (SHA-256)</span>
          <input
            value={form.fingerprint} onChange={e => set('fingerprint', e.target.value)}
            placeholder="ab:cd:ef:…" className={`${inputCls} font-mono`}
          />
        </label>
      </div>
      <p className="text-[11px] text-gray-600 mb-5">
        The fingerprint pins the PBS certificate (shown on the PBS dashboard) — required for the usual
        self-signed setup, so credentials are never sent to an unverified server. Grant the token{' '}
        <span className="font-mono text-gray-500">Datastore.Audit</span> only: read-only is all the dashboard needs.
      </p>
      <button onClick={save} disabled={busy} className={btnPrimary}>Save</button>
      <Msg msg={msg} />
    </Section>
  )
}

export default function Settings() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getSettings().then(setData).catch(e => setErr(e.message))
  }, [])

  if (err) return <div className="p-4 sm:p-8 text-sm text-red-400">{err}</div>
  if (!data) return <div className="p-4 sm:p-8 text-sm text-gray-600">Loading…</div>

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-3xl">
      <TwoFASection initial={data.totp} />
      <NotifySection initial={data.notify} />
      <PBSSection initial={data.pbs} />
    </div>
  )
}
