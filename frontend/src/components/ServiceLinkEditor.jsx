import { useState, useEffect, useRef } from 'react'
import { upsertServiceLink, deleteServiceLink } from '../lib/api'
import { useStaggerMount } from './motion'

// ServiceLinkEditor — popover or inline card editor for an entity's primary
// web service link plus up to 8 extra links (e.g. multi-app Docker LXC).
export default function ServiceLinkEditor({
  entityType,
  entityId,
  link,
  onDone,
  onClose,
  inline = false,
}) {
  const [url, setUrl] = useState(link?.url ?? '')
  const [label, setLabel] = useState(link?.label ?? '')
  const [extras, setExtras] = useState(link?.extras ?? [])
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const popoverRef = useRef(null)
  useStaggerMount(popoverRef)

  useEffect(() => {
    if (inline) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, inline])

  const setExtra = (i, k, v) => setExtras(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  async function save() {
    setSaving(true); setErr(null)
    try {
      const clean = extras.filter(x => x.url)
      await upsertServiceLink(entityType, entityId, url, label || null, clean)
      onDone()
      onClose()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  async function remove() {
    try {
      await deleteServiceLink(entityType, entityId)
      onDone()
      onClose()
    } catch (e) {
      setErr(e.message)
    }
  }

  const cls = inline
    ? 'bg-[#0c0c14] border border-white/10 rounded-xl p-3.5 w-full'
    : 'absolute top-7 right-0 z-40 bg-[#13131e] border border-white/20 rounded-xl p-3.5 shadow-2xl w-72'

  const inputCls = 'w-full bg-[#0c0c14] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50'

  return (
    <div ref={popoverRef} data-lenis-prevent className={cls} onClick={e => e.stopPropagation()}>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Service link</p>
      <input
        autoFocus
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        placeholder="http://192.168.1.50:8080"
        className={`${inputCls} mb-1.5 font-mono`}
      />
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        placeholder="Display label (optional)"
        className={`${inputCls} mb-2`}
      />
      {extras.length > 0 && <p className="text-[11px] text-gray-500 mb-1">Additional links</p>}
      {extras.map((x, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input
            value={x.url}
            onChange={e => setExtra(i, 'url', e.target.value)}
            placeholder="http://…"
            className="flex-1 min-w-0 bg-[#0c0c14] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500/50"
          />
          <input
            value={x.label}
            onChange={e => setExtra(i, 'label', e.target.value)}
            placeholder="Label"
            className="w-20 bg-[#0c0c14] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={() => setExtras(xs => xs.filter((_, j) => j !== i))}
            title="Remove this link"
            className="text-gray-600 hover:text-red-400 text-xs px-1 transition-colors"
          >
            ✕
          </button>
        </div>
      ))}
      {extras.length < 8 && (
        <button
          type="button"
          onClick={() => setExtras(xs => [...xs, { url: '', label: '' }])}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors mb-2.5"
        >
          + Add another link
        </button>
      )}
      {err && <p className="text-[11px] text-red-400 mb-1.5">{err}</p>}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={saving || !url}
          className="flex-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {link && (
          <button
            type="button"
            onClick={remove}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1.5 rounded-lg border border-white/10 text-gray-500 hover:text-gray-300 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
