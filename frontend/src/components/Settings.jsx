import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getSettings, putProxmoxSettings, testProxmoxSettings,
  putNotifySettings, testNotify, putPBSSettings, testPBSSettings,
  twoFASetup, twoFAEnable, twoFADisable, getUpdateCheck,
  changePassword, exportConfig, importConfig,
} from '../lib/api'
import { encodeQR, qrToSvgPath } from '../lib/qrcode'
import { useSelfUpdate } from '../hooks/useSelfUpdate'
import { INSTALL_CMD } from './UpdateBanner'
import Themes from './Themes'
import { useScrollReveal } from './motion'

const inputCls = 'w-full bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-700 focus:outline-none focus:border-blue-500/50'
const labelCls = 'block text-xs text-gray-500 mb-1.5'
const btnPrimary = 'text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40'
const btnGhost = 'text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors disabled:opacity-40'

function Section({ title, subtitle, children }) {
  return (
    <div data-reveal="" className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6">
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

// Offline scannable QR code SVG (always black-on-white for camera contrast across all themes).
function QRCodeBox({ value, size = 168 }) {
  const svg = useMemo(() => {
    try {
      const { matrix } = encodeQR(value)
      return qrToSvgPath(matrix, 4)
    } catch {
      return null
    }
  }, [value])

  if (!svg) return null
  return (
    <div className="inline-block rounded-xl p-2 shadow-inner" style={{ background: '#ffffff' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${svg.viewBoxSize} ${svg.viewBoxSize}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label="Two-factor authentication QR code"
      >
        <rect width={svg.viewBoxSize} height={svg.viewBoxSize} fill="#ffffff" />
        <path d={svg.path} fill="#000000" />
      </svg>
    </div>
  )
}

// --- Password ---

function PasswordSection({ totpEnabled }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function save(e) {
    e.preventDefault()
    setMsg(null)
    if (next.length < 8) {
      setMsg({ ok: false, text: 'New password must be at least 8 characters.' })
      return
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: 'New passwords do not match.' })
      return
    }
    if (totpEnabled && !code.trim()) {
      setMsg({ ok: false, text: 'Enter a 2FA code to confirm the password change.' })
      return
    }
    setBusy(true)
    try {
      await changePassword(cur, next, totpEnabled ? code.trim() : undefined)
      setCur('')
      setNext('')
      setConfirm('')
      setCode('')
      setMsg({ ok: true, text: 'Password updated. Other active sessions have been signed out.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Admin password"
      subtitle="Change the local dashboard password. Updating it revokes any other active browser sessions."
    >
      <form onSubmit={save} className="space-y-4 max-w-md">
        <label className="block">
          <span className={labelCls}>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={cur}
            onChange={e => setCur(e.target.value)}
            required
            className={inputCls}
          />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>New password (min 8 chars)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={e => setNext(e.target.value)}
              required
              minLength={8}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              minLength={8}
              className={inputCls}
            />
          </label>
        </div>
        {totpEnabled && (
          <label className="block max-w-xs">
            <span className={labelCls}>2FA or recovery code</span>
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              className={`${inputCls} font-mono`}
            />
          </label>
        )}
        <button type="submit" disabled={busy || !cur || !next || !confirm} className={btnPrimary}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
        <Msg msg={msg} />
      </form>
    </Section>
  )
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
  ['service_down', 'A linked web service becomes unreachable (and recovers)'],
  ['updates_available', 'apt updates are available (daily digest)'],
  ['backup_failed', 'A vzdump backup job fails'],
  ['pbs_verify_failed', 'A PBS backup fails verification'],
]

function NotifySection({ initial }) {
  const [form, setForm] = useState({
    provider: initial.provider || 'ntfy',
    url: initial.url || '',
    token: '',
    insecure: !!initial.insecure,
    job_failed: !!initial.job_failed,
    node_offline: !!initial.node_offline,
    service_down: !!initial.service_down,
    updates_available: !!initial.updates_available,
    backup_failed: !!initial.backup_failed,
    pbs_verify_failed: !!initial.pbs_verify_failed,
    storage_threshold: initial.storage_threshold || 0,
    backup_stale_days: initial.backup_stale_days || 0,
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
      await putNotifySettings({
        ...form,
        storage_threshold: Number(form.storage_threshold) || 0,
        backup_stale_days: Number(form.backup_stale_days) || 0,
        token: form.token === '' ? null : form.token,
      })
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

      {/* Threshold-based alerts */}
      <div className="grid sm:grid-cols-2 gap-4 mb-4 pt-3 border-t border-white/[0.06]">
        <label>
          <span className={labelCls}>Storage pool alert threshold (%) <span className="text-gray-700">— 0 disables</span></span>
          <input
            type="number"
            min="0"
            max="99"
            value={form.storage_threshold}
            onChange={e => set('storage_threshold', e.target.value)}
            placeholder="0 (or e.g. 85)"
            className={inputCls}
          />
          <p className="text-[11px] text-gray-600 mt-1">Alert when a pool stays at or above 50–99% full.</p>
        </label>
        <label>
          <span className={labelCls}>Stale backup alert (days) <span className="text-gray-700">— 0 disables</span></span>
          <input
            type="number"
            min="0"
            max="365"
            value={form.backup_stale_days}
            onChange={e => set('backup_stale_days', e.target.value)}
            placeholder="0 (or e.g. 7)"
            className={inputCls}
          />
          <p className="text-[11px] text-gray-600 mt-1">Daily digest if a guest has no backup within N days.</p>
        </label>
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

function TwoFASection({ initial, onChanged }) {
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
      onChanged?.(true)
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
      onChanged?.(false)
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
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <QRCodeBox value={setup.otpauth_uri} size={160} />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-sm text-gray-300">
                1. Scan this QR code in your authenticator app (Aegis, Google Authenticator, 1Password…) or enter the key manually:
              </p>
              <code className="block bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-emerald-300 font-mono tracking-wider break-all select-all">
                {setup.secret}
              </code>
              <p className="text-[11px] text-gray-600">
                Type: time-based (TOTP) · 6 digits · 30 s. On this device? <a className="text-blue-400 hover:underline" href={setup.otpauth_uri}>open in authenticator</a>.
              </p>
            </div>
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

// --- Proxmox VE API ---

function ProxmoxSection({ initial }) {
  const [form, setForm] = useState({
    host: initial?.host || '',
    token_id: initial?.token_id || '',
    secret: '',
  })
  const [hasSecret, setHasSecret] = useState(!!initial?.has_secret)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setBusy(true); setMsg(null)
    try {
      await putProxmoxSettings({
        host: form.host.trim(),
        token_id: form.token_id.trim(),
        secret: form.secret === '' ? null : form.secret,
      })
      if (form.secret && form.secret !== '-') setHasSecret(true)
      if (form.secret === '-' || !form.host.trim()) setHasSecret(false)
      set('secret', '')
      setMsg({
        ok: true,
        text: form.host.trim()
          ? 'Saved — dashboard polling updated immediately.'
          : 'Proxmox API credentials cleared.',
      })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setMsg(null)
    try {
      const res = await testProxmoxSettings({
        host: form.host.trim(),
        token_id: form.token_id.trim(),
        secret: form.secret === '' ? null : form.secret,
      })
      const n = res?.nodes ?? 0
      setMsg({ ok: true, text: `Connected — ${n} node${n !== 1 ? 's' : ''} discovered.` })
    } catch (e) { setMsg({ ok: false, text: `Connection failed: ${e.message}` }) }
    finally { setBusy(false) }
  }

  return (
    <Section
      title="Proxmox VE connection"
      subtitle={
        initial?.local_pve
          ? 'Auto-provisioned via local pveum. Override here to point at another endpoint or token.'
          : 'Connect SuperDash to your Proxmox VE API using an API token (LXC / standalone mode).'
      }
    >
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <label className="sm:col-span-2">
          <span className={labelCls}>Proxmox Host URL <span className="text-gray-700">— empty disables</span></span>
          <input
            value={form.host}
            onChange={e => set('host', e.target.value)}
            placeholder="https://192.168.1.10:8006"
            className={inputCls}
          />
        </label>
        <label>
          <span className={labelCls}>API token ID</span>
          <input
            value={form.token_id}
            onChange={e => set('token_id', e.target.value)}
            placeholder="simpdash@pve!dashtoken"
            className={`${inputCls} font-mono`}
          />
        </label>
        <label>
          <span className={labelCls}>
            Token secret {hasSecret ? <span className="text-emerald-500">— stored</span> : ''}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={form.secret}
            onChange={e => set('secret', e.target.value)}
            placeholder={hasSecret ? 'Leave empty to keep, "-" to clear' : 'UUID secret'}
            className={inputCls}
          />
        </label>
      </div>
      <p className="text-[11px] text-gray-600 mb-5">
        Recommended role privileges:{' '}
        <span className="font-mono text-gray-500">VM.Audit, Sys.Audit, Datastore.Audit</span> (add{' '}
        <span className="font-mono text-gray-500">VM.PowerMgmt, Sys.PowerMgmt</span> for power buttons) with Privilege Separation disabled.
      </p>
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className={btnPrimary}>Save</button>
        <button onClick={test} disabled={busy} className={btnGhost}>Test connection</button>
      </div>
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
      if (form.secret === '-' || !form.url.trim()) setHasSecret(false)
      setMsg({ ok: true, text: form.url ? 'Saved — the Backups tab now shows PBS data.' : 'PBS integration disabled.' })
      set('secret', '')
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setMsg(null)
    try {
      const res = await testPBSSettings({
        url: form.url.trim(),
        token_id: form.token_id.trim(),
        secret: form.secret === '' ? null : form.secret,
        fingerprint: form.fingerprint.trim(),
      })
      setMsg({
        ok: true,
        text: `Connected — ${res?.datastores ?? 0} datastore${res?.datastores !== 1 ? 's' : ''}, ${res?.guests ?? 0} backed-up guest${res?.guests !== 1 ? 's' : ''}.`,
      })
    } catch (e) { setMsg({ ok: false, text: `Connection failed: ${e.message}` }) }
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
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className={btnPrimary}>Save</button>
        <button onClick={test} disabled={busy} className={btnGhost}>Test connection</button>
      </div>
      <Msg msg={msg} />
    </Section>
  )
}

// --- Config backup & restore ---

function BackupRestoreSection({ onImported }) {
  const [mode, setMode] = useState('merge')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef(null)

  async function handleExport() {
    setBusy(true); setMsg(null)
    try {
      const bundle = await exportConfig()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `superdash-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg({ ok: true, text: 'Exported service links, notes, schedules, and LXC excludes (no secrets included).' })
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const res = await importConfig({ ...parsed, mode })
      const imp = res?.imported || {}
      setMsg({
        ok: true,
        text: `Imported (${mode}): ${imp.service_links ?? 0} links, ${imp.notes ?? 0} notes, ${imp.schedules ?? 0} schedules, ${imp.lxc_update_exclude ?? 0} excludes.`,
      })
      onImported?.()
    } catch (err) {
      setMsg({ ok: false, text: `Import failed: ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Backup & restore"
      subtitle="Export or restore your service links, notebook notes, schedules, and LXC exclude list. Passwords and API secrets are never exported."
    >
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleExport} disabled={busy} className={btnPrimary}>
          Export JSON
        </button>

        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={e => setMode(e.target.value)}
            aria-label="Import mode"
            className="bg-[#0c0c14] border border-white/10 rounded-lg px-2.5 py-2 text-xs text-gray-300 focus:outline-none focus:border-blue-500/50"
          >
            <option value="merge">Merge with existing</option>
            <option value="replace">Replace existing</option>
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={busy} className={btnGhost}>
            {busy ? 'Working…' : 'Import JSON…'}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
        </div>
      </div>
      <Msg msg={msg} />
    </Section>
  )
}

// --- SimpDash version & self-update ---

function VersionSection() {
  const [info, setInfo] = useState(null)
  const [checking, setChecking] = useState(false)
  const [checkErr, setCheckErr] = useState(null)
  const [checkedNow, setCheckedNow] = useState(false)
  const [copied, setCopied] = useState(false)
  const updater = useSelfUpdate()

  useEffect(() => {
    getUpdateCheck().then(setInfo).catch(() => {})
  }, [])

  async function refresh() {
    setChecking(true)
    setCheckErr(null)
    setCheckedNow(false)
    try {
      const res = await getUpdateCheck(true)
      setInfo(res)
      setCheckedNow(true)
    } catch (e) {
      setCheckErr(e.message || 'Update check failed')
    } finally {
      setChecking(false)
    }
  }

  function copyCli() {
    navigator.clipboard?.writeText(INSTALL_CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isDev = info?.current_version === 'dev'

  return (
    <Section
      title="SuperDash updates"
      subtitle="Check for new SuperDash releases and update the dashboard binary in place."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Installed version:</span>
            <span className="font-mono text-white">{info?.current_version || '—'}</span>
            {info?.update_available && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                {info.latest_version} available
              </span>
            )}
            {info && !info.update_available && !isDev && info.latest_version && (
              <span className="text-xs text-emerald-400/80">Up to date</span>
            )}
          </div>
          {isDev && (
            <p className="text-xs text-gray-500">
              Development build — one-click updates are disabled.
            </p>
          )}
          {info?.release_url && info?.update_available && (
            <p className="text-xs text-gray-500">
              <a
                href={info.release_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                View {info.latest_version} release notes ↗
              </a>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={checking || updater.busy}
            className={btnGhost}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </button>

          {info?.update_available && info?.can_self_update && updater.phase === 'idle' && (
            <button
              onClick={updater.askConfirm}
              className="text-xs px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
            >
              Update to {info.latest_version}
            </button>
          )}
        </div>
      </div>

      {updater.phase === 'confirm' && info && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <p className="text-xs text-emerald-200 flex-1">
            Download &amp; verify <span className="font-semibold">{info.latest_version}</span> and restart SuperDash (~5 s)?
          </p>
          <button
            onClick={() => updater.run(info.latest_version, info.current_version)}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
          >
            Confirm update
          </button>
          <button onClick={updater.cancel} className={btnGhost}>Cancel</button>
        </div>
      )}

      {updater.busy && (
        <p className="text-xs text-emerald-300 mt-3">
          {updater.phase === 'downloading' && `Downloading & verifying ${updater.targetVersion || info?.latest_version}…`}
          {updater.phase === 'restarting' && `Restarting SuperDash — waiting for ${updater.targetVersion || info?.latest_version}…`}
          {updater.phase === 'reloading' && `Updated to ${updater.targetVersion || info?.latest_version} — reloading…`}
        </p>
      )}

      {updater.error && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-red-400">{updater.error}</p>
          <button
            onClick={() => updater.run(info?.latest_version, info?.current_version)}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {info?.update_available && !info?.can_self_update && (
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">
            Prebuilt self-update assets are unavailable for this release — update via CLI:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono overflow-x-auto whitespace-nowrap">
              {INSTALL_CMD}
            </code>
            <button onClick={copyCli} className={btnGhost}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {checkErr && <p className="text-xs text-red-400 mt-3">{checkErr}</p>}
      {checkedNow && !checkErr && !info?.update_available && !isDev && (
        <p className="text-xs text-emerald-400 mt-3">
          {info?.latest_version ? `You're on the latest release (${info.latest_version}).` : 'No releases published yet.'}
        </p>
      )}
    </Section>
  )
}

export default function Settings({ theme, setTheme, onDataImported }) {
  const [data, setData] = useState(null)
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [err, setErr] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => {
    getSettings()
      .then((d) => { setData(d); setTotpEnabled(!!d?.totp?.enabled) })
      .catch(e => setErr(e.message))
  }, [])

  useScrollReveal(containerRef, { theme, deps: [Boolean(data)] })

  if (err) return <div className="p-4 sm:p-8 text-sm text-red-400">{err}</div>
  if (!data) return <div className="p-4 sm:p-8 text-sm text-gray-600">Loading…</div>

  return (
    <div ref={containerRef} className="p-4 sm:p-8 space-y-6 max-w-3xl">
      <Section title="Appearance" subtitle="Choose a colour theme.">
        <Themes theme={theme} setTheme={setTheme} embedded />
      </Section>
      <PasswordSection totpEnabled={totpEnabled} />
      <TwoFASection initial={data.totp} onChanged={setTotpEnabled} />
      <ProxmoxSection initial={data.proxmox} />
      <NotifySection initial={data.notify} />
      <PBSSection initial={data.pbs} />
      <BackupRestoreSection onImported={onDataImported} />
      <VersionSection />
    </div>
  )
}
