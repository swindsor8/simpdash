import { useState } from 'react'
import { pairNode, unpairNode } from '../lib/api'

// Nodes — pair and manage secondary agents. Adding a node calls the main-side
// /api/nodes/pair, which reaches out to the secondary's agent with the pairing
// code and stores the returned token. Removing a node forgets that token.
export default function Nodes({ nodes, onChange }) {
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function handleAdd(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await pairNode(address.trim(), code.trim())
      setAddress('')
      setCode('')
      onChange()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id) {
    try {
      await unpairNode(id)
      onChange()
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      {/* Add node */}
      <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white mb-1">Add a node</h2>
        <p className="text-xs text-gray-500 mb-4">
          On the secondary, run SimpDash in <span className="font-mono text-gray-400">secondary</span> mode.
          Its pairing code and address are printed to the console / <span className="font-mono text-gray-400">systemctl status</span>.
        </p>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-[200px]">
            <span className="block text-xs text-gray-500 mb-1.5">Address</span>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="192.168.1.20:7575"
              required
              className="w-full bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-gray-700 focus:outline-none focus:border-blue-500/50"
            />
          </label>
          <label className="w-40">
            <span className="block text-xs text-gray-500 mb-1.5">Pairing code</span>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C3"
              required
              className="w-full bg-[#0c0c14] border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-blue-500/50"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40"
          >
            {busy ? 'Pairing…' : 'Pair node'}
          </button>
        </form>
        {err && <p className="text-xs text-red-400 mt-3">{err}</p>}
      </div>

      {/* Paired nodes */}
      <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-white">Paired nodes</h2>
        </div>
        {nodes.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-600 text-center">No secondary nodes paired yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {nodes.map(n => (
              <li key={n.id} className="flex items-center justify-between px-6 py-3.5">
                <div>
                  <p className="text-sm text-gray-200 font-mono">{n.address}</p>
                  <p className="text-[11px] text-gray-600">node {n.id}</p>
                </div>
                <button
                  onClick={() => handleRemove(n.id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
