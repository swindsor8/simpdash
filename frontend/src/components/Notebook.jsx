import { useState, useEffect, useMemo, useDeferredValue, useCallback } from 'react'
import { getNotes, createNote, updateNote, deleteNote } from '../lib/api'
import { copy, loadingText } from '../lib/copy'

const COLORS = ['yellow', 'teal', 'pink', 'blue']
// Muted, desaturated sticky tones that read against the #0a0b0f background —
// not raw highlighter yellow.
const CARD = {
  yellow: 'bg-amber-300/[0.08] border-amber-300/25',
  teal: 'bg-teal-300/[0.08] border-teal-300/25',
  pink: 'bg-pink-300/[0.08] border-pink-300/25',
  blue: 'bg-sky-300/[0.08] border-sky-300/25',
}
const SWATCH = { yellow: 'bg-amber-300', teal: 'bg-teal-300', pink: 'bg-pink-300', blue: 'bg-sky-300' }

// Deterministic tilt seeded by note id, so cards don't re-randomise per render.
const tilt = (id) => ((id * 37) % 5) - 2 // -2..2 deg
const entityKey = (t, i) => (t ? `${t}:${i}` : '')

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
function fullDate(iso) { return new Date(iso).toLocaleString() }

function entityLabel(type, id, entities) {
  const e = entities?.find((x) => x.type === type && x.id === id)
  if (e) return e.label
  if (type === 'node') return id
  return `${type === 'vm' ? 'VM' : 'CT'} ${id}`
}

// --- icons (16px stroke, matching Dashboard) ---
function IconPin({ filled }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14l-1.5-4.5a2 2 0 0 1 .5-2L20 8l-2-5H6L4 8l2 2.5a2 2 0 0 1 .5 2z" />
    </svg>
  )
}
function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  )
}
function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
function IconNotebook() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" /><path d="M18 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2" /><line x1="6" y1="8" x2="14" y2="8" /><line x1="6" y1="12" x2="14" y2="12" /><line x1="6" y1="16" x2="11" y2="16" />
    </svg>
  )
}

// EntityPicker is a native <select> grouping nodes / VMs / CTs. value is ''
// (general) or 'type:id'.
function EntityPicker({ value, onChange, entities, generalLabel, allOption, className }) {
  const nodes = entities.filter((e) => e.type === 'node')
  const vms = entities.filter((e) => e.type === 'vm')
  const cts = entities.filter((e) => e.type === 'lxc')
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {allOption && <option value="__all">All notes</option>}
      <option value="">{generalLabel}</option>
      {nodes.length > 0 && (
        <optgroup label="Nodes">{nodes.map((e) => <option key={`node:${e.id}`} value={`node:${e.id}`}>{e.label}</option>)}</optgroup>
      )}
      {vms.length > 0 && (
        <optgroup label="Virtual machines">{vms.map((e) => <option key={`vm:${e.id}`} value={`vm:${e.id}`}>{e.label}</option>)}</optgroup>
      )}
      {cts.length > 0 && (
        <optgroup label="Containers">{cts.map((e) => <option key={`lxc:${e.id}`} value={`lxc:${e.id}`}>{e.label}</option>)}</optgroup>
      )}
    </select>
  )
}

function NoteCard({ note, entities, onChanged, onCountsChanged, onFilterEntity }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.content)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const color = CARD[note.color] || CARD.yellow

  async function togglePin() {
    setBusy(true)
    try { await updateNote(note.id, { pinned: !note.pinned }); onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  async function saveEdit() {
    const c = draft.trim()
    if (!c) return
    setBusy(true)
    try { await updateNote(note.id, { content: c }); setEditing(false); onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  function doDelete() {
    setRemoving(true) // fade out, then commit
    setTimeout(async () => {
      try { await deleteNote(note.id); onCountsChanged(); onChanged() }
      catch (e) { alert(e.message); setRemoving(false) }
    }, 180)
  }

  return (
    <div className="mb-4 break-inside-avoid" style={{ transform: `rotate(${tilt(note.id)}deg)` }}>
      <article className={`animate-note-in transition-opacity duration-200 rounded-xl border p-4 shadow-lg shadow-black/30 ${color} ${removing ? 'opacity-0' : ''}`}>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveEdit() }}
            rows={4}
            maxLength={2000}
            className="w-full bg-black/20 rounded-lg p-2 text-sm text-gray-100 resize-y focus:outline-none focus:ring-1 focus:ring-white/20"
          />
        ) : (
          <p className="text-sm text-gray-100 whitespace-pre-wrap break-words">{note.content}</p>
        )}

        {note.entity_type && (
          <button
            onClick={() => onFilterEntity(note.entity_type, note.entity_id)}
            title={`Filter notes for ${entityLabel(note.entity_type, note.entity_id, entities)}`}
            className="mt-3 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-black/25 text-gray-300 hover:bg-black/40 transition-colors"
          >
            {entityLabel(note.entity_type, note.entity_id, entities)}
          </button>
        )}

        <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400" title={fullDate(note.created_at)}>{timeAgo(note.created_at)}</span>
          <div className="flex items-center gap-1 text-gray-400">
            {editing ? (
              <>
                <button onClick={saveEdit} disabled={busy} className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-gray-100">Save</button>
                <button onClick={() => { setEditing(false); setDraft(note.content) }} className="text-[11px] px-2 py-0.5 rounded hover:bg-white/10">Cancel</button>
              </>
            ) : confirming ? (
              <>
                <span className="text-[11px] text-gray-300">Delete?</span>
                <button onClick={doDelete} className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30">Yes</button>
                <button onClick={() => setConfirming(false)} className="text-[11px] px-2 py-0.5 rounded hover:bg-white/10">No</button>
              </>
            ) : (
              <>
                <button onClick={togglePin} disabled={busy} title={note.pinned ? 'Unpin' : 'Pin to top'} className={`p-1 rounded hover:bg-white/10 ${note.pinned ? 'text-amber-300' : ''}`}>
                  <IconPin filled={note.pinned} />
                </button>
                <button onClick={() => { setEditing(true); setDraft(note.content) }} title="Edit" className="p-1 rounded hover:bg-white/10"><IconEdit /></button>
                <button onClick={() => setConfirming(true)} title="Delete" className="p-1 rounded hover:bg-white/10 hover:text-red-300"><IconTrash /></button>
              </>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}

function QuickAdd({ entities, onCreated, onCountsChanged }) {
  const [content, setContent] = useState('')
  const [entity, setEntity] = useState('') // '' = general, else 'type:id'
  const [color, setColor] = useState('yellow')
  const [busy, setBusy] = useState(false)

  async function save() {
    const c = content.trim()
    if (!c) return
    const [type, id] = entity ? entity.split(':') : [null, null]
    setBusy(true)
    try {
      await createNote({ content: c, color, ...(type ? { entity_type: type, entity_id: id } : {}) })
      setContent('')
      onCreated()
      if (type) onCountsChanged()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="bg-[#13131e] border border-white/[0.07] rounded-2xl p-4 mb-6">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save() }}
        placeholder="Jot something down… why you made that change, what to remember."
        rows={2}
        maxLength={2000}
        className="w-full bg-[#0c0c14] border border-white/10 rounded-lg p-3 text-sm text-gray-100 resize-y focus:outline-none focus:border-blue-500/50 placeholder:text-gray-600"
      />
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <EntityPicker
            value={entity}
            onChange={setEntity}
            entities={entities}
            generalLabel="General note"
            className="bg-[#0c0c14] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
          />
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                className={`w-5 h-5 rounded-full ${SWATCH[c]} transition-transform ${color === c ? 'ring-2 ring-white/70 scale-110' : 'opacity-60 hover:opacity-100'}`}
              />
            ))}
          </div>
        </div>
        <button
          onClick={save}
          disabled={busy || !content.trim()}
          className="text-sm px-4 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add note
        </button>
      </div>
    </div>
  )
}

export default function Notebook({ entities = [], filter, onCountsChanged = () => {} }) {
  const [notes, setNotes] = useState(null) // null = loading
  const [query, setQuery] = useState('')
  const [entityFilter, setEntityFilter] = useState('__all') // '__all' | '' (general) | 'type:id'
  const deferredQuery = useDeferredValue(query)
  const loadingMsg = useMemo(() => loadingText('Loading notes…'), [])

  const load = useCallback(() => {
    getNotes().then(setNotes).catch(() => setNotes([]))
  }, [])
  useEffect(() => { load() }, [load])

  // A badge click on a tile pre-filters to that entity.
  useEffect(() => {
    if (filter && filter.entity_type) setEntityFilter(entityKey(filter.entity_type, filter.entity_id))
  }, [filter])

  const filtered = useMemo(() => {
    if (!notes) return []
    const q = deferredQuery.trim().toLowerCase()
    return notes.filter((n) => {
      if (entityFilter === '') { if (n.entity_type) return false }
      else if (entityFilter !== '__all' && entityKey(n.entity_type, n.entity_id) !== entityFilter) return false
      if (q && !n.content.toLowerCase().includes(q)) return false
      return true
    })
  }, [notes, entityFilter, deferredQuery])

  return (
    <div className="p-8 max-w-6xl">
      <QuickAdd entities={entities} onCreated={load} onCountsChanged={onCountsChanged} />

      {notes && notes.length > 0 && (
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 min-w-[180px] bg-[#13131e] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 placeholder:text-gray-600"
          />
          <EntityPicker
            value={entityFilter === '__all' ? '__all' : entityFilter}
            onChange={setEntityFilter}
            entities={entities}
            generalLabel="General notes"
            allOption
            className="bg-[#13131e] border border-white/10 rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      )}

      {notes === null ? (
        <p className="text-sm text-gray-600 py-10 text-center">{loadingMsg}</p>
      ) : notes.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 text-gray-600 mb-4"><IconNotebook /></div>
          <p className="text-sm text-gray-300 font-medium">{copy('empty.notebook', 'Nothing here yet.')}</p>
          <p className="text-xs text-gray-600 mt-1 max-w-sm mx-auto">Future-you will thank present-you for jotting down why you made that change.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-600 py-10 text-center">No notes match your search.</p>
      ) : (
        <div className="columns-1 sm:columns-2 xl:columns-3 gap-4">
          {filtered.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              entities={entities}
              onChanged={load}
              onCountsChanged={onCountsChanged}
              onFilterEntity={(t, i) => setEntityFilter(entityKey(t, i))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
