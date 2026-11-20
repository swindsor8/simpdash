import { useState, useRef } from 'react'
import { setupPassword } from '../lib/api'
import logo from '../../assets/logo.png'
import { useStaggerMount } from './motion'

const TOKEN_COMMANDS = `pveum role add SimpDash -privs "VM.Audit,Sys.Audit,Datastore.Audit,VM.PowerMgmt,Sys.PowerMgmt"
pveum user add simpdash@pve
pveum acl modify / -user simpdash@pve -role SimpDash
pveum user token add simpdash@pve dashtoken --privsep 0`

const inputCls =
  'w-full bg-[#13131e] text-white border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 placeholder-gray-600 text-sm transition-colors'

export default function SetupPassword({ pveLocal = true, onDone }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pxHost, setPxHost] = useState('')
  const [pxTokenID, setPxTokenID] = useState('')
  const [pxSecret, setPxSecret] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const formWrapRef = useRef(null)
  useStaggerMount(formWrapRef, '[data-stagger]')

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) return setError('Password must be at least 8 characters')
    if (pw !== confirm) return setError('Passwords do not match')

    const anyPx = pxHost.trim() || pxTokenID.trim() || pxSecret.trim()
    let proxmox = null
    if (!pveLocal && anyPx) {
      if (!pxHost.trim() || !pxTokenID.trim() || !pxSecret.trim()) {
        return setError('Fill in all three Proxmox API fields, or leave them all blank to configure later in Settings.')
      }
      proxmox = {
        host: pxHost.trim(),
        token_id: pxTokenID.trim(),
        secret: pxSecret.trim(),
      }
    }

    setLoading(true)
    setError('')
    try {
      await setupPassword(pw, proxmox)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0c0c14] flex items-center justify-center p-4">
      <div ref={formWrapRef} className={`w-full ${pveLocal ? 'max-w-sm' : 'max-w-md'}`}>
        <div data-stagger="" className="flex items-center gap-2.5 mb-8">
          <img src={logo} alt="SuperDash" className="w-8 h-8 rounded-lg object-contain" />
          <span className="font-semibold text-white">SuperDash</span>
        </div>
        <h1 data-stagger="" className="text-2xl font-bold text-white mb-1">Set up your dashboard</h1>
        <p data-stagger="" className="text-gray-500 mb-6 text-sm">
          {pveLocal
            ? 'Choose an admin password to get started.'
            : 'Choose an admin password and connect your Proxmox VE API token.'}
        </p>

        <form data-stagger="" onSubmit={submit} className="space-y-3">
          <input
            type="password"
            placeholder="Admin password (min 8 chars)"
            value={pw}
            onChange={e => setPw(e.target.value)}
            className={inputCls}
            autoFocus
            required
          />
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className={inputCls}
            required
          />

          {!pveLocal && (
            <div className="pt-4 mt-2 border-t border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">Proxmox VE API</h2>
                  <p className="text-xs text-gray-500">
                    Local <span className="font-mono">pveum</span> was not detected (LXC / standalone install). Optional now — editable in Settings.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHelp(v => !v)}
                  className="shrink-0 text-xs text-blue-400 hover:underline"
                >
                  {showHelp ? 'Hide guide' : 'How to create?'}
                </button>
              </div>

              {showHelp && (
                <div className="bg-[#13131e] border border-white/[0.07] rounded-xl p-3 space-y-2">
                  <p className="text-xs text-gray-400">
                    Run these 4 commands on your Proxmox host (or create an API token in Datacenter → Permissions with Privilege Separation unchecked):
                  </p>
                  <pre className="bg-[#0c0c14] border border-white/[0.06] rounded-lg p-2.5 text-[11px] text-emerald-300 font-mono overflow-x-auto whitespace-pre">
                    {TOKEN_COMMANDS}
                  </pre>
                </div>
              )}

              <input
                type="url"
                placeholder="Proxmox URL (e.g. https://192.168.1.10:8006)"
                value={pxHost}
                onChange={e => setPxHost(e.target.value)}
                className={inputCls}
              />
              <input
                placeholder="API Token ID (e.g. simpdash@pve!dashtoken)"
                value={pxTokenID}
                onChange={e => setPxTokenID(e.target.value)}
                className={`${inputCls} font-mono`}
              />
              <input
                type="password"
                autoComplete="off"
                placeholder="API Token Secret"
                value={pxSecret}
                onChange={e => setPxSecret(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? 'Setting up…' : (pveLocal ? 'Set password' : 'Complete setup')}
          </button>
        </form>
      </div>
    </div>
  )
}
