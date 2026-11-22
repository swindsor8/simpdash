import { useState, useEffect, useMemo, useRef } from 'react'
import { THEMES } from '../hooks/useTheme'
import { consoleUrl } from './GuestCard'
import { StatusPill, statusVariant } from './Card'
import {
  IconSearch, IconGrid, IconHardware, IconWifi, IconTerminal, IconArchive,
  IconCalendarClock, IconActivity, IconNote, IconNetwork, IconSettings,
  IconMonitor, IconBox, IconPalette, IconLogout, IconList,
} from './Icons'
import { useFocusTrap } from '../lib/a11y'

export const THEME_SWATCHES = {
  nocturne: 'linear-gradient(135deg, #4f46e5, #2bc8b7)',
  default:  'linear-gradient(135deg, #f5f6fb, #6366f1)',
  retro:    'linear-gradient(135deg, #f4f0f8, #f24c00)',
  mario:    'linear-gradient(135deg, #5c94fc, #fbd000)',
  win98:    'linear-gradient(135deg, #008080, #000080)',
  terminal: 'linear-gradient(135deg, #020a02, #1aff40)',
  glass:    'linear-gradient(135deg, #5e1f6e, #0c5d57)',
}

const NAV_COMMANDS = [
  { id: 'dashboard', label: 'Dashboard', hint: 'Node overview, guests & updates', icon: <IconGrid /> },
  { id: 'hardware',  label: 'Hardware Health', hint: 'Thermal sensors, SMART drives & ZFS', icon: <IconHardware /> },
  { id: 'network',   label: 'Network', hint: 'Interfaces, throughput & speedtest', icon: <IconWifi /> },
  { id: 'scripts',   label: 'Script Catalog', hint: 'Community-scripts one-click installs', icon: <IconTerminal /> },
  { id: 'backups',   label: 'Backups', hint: 'vzdump & Proxmox Backup Server', icon: <IconArchive /> },
  { id: 'schedules', label: 'Schedules', hint: 'Recurring & one-time automation', icon: <IconCalendarClock /> },
  { id: 'activity',  label: 'Activity', hint: 'Job logs & Proxmox cluster tasks', icon: <IconActivity /> },
  { id: 'notebook',  label: 'Notebook', hint: 'Sticky notes & checklists', icon: <IconNote /> },
  { id: 'nodes',     label: 'Nodes', hint: 'Pair & manage secondary agents', icon: <IconNetwork /> },
  { id: 'settings',  label: 'Settings', hint: 'Themes, 2FA, alerts & backup/export', icon: <IconSettings /> },
]

// CommandPalette — Cmd+K / Ctrl+K quick launcher for jumping to any guest,
// opening web services, switching views, or previewing all 7 themes live.
export default function CommandPalette({
  open,
  onClose,
  nodes,
  serviceLinks,
  pveURL,
  theme,
  setTheme,
  onNavigate,
  onInspectGuest,
  onToggleRunning,
  onToggleLayout,
  guestLayout,
  runningOnly,
  onLogout,
}) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const trap = useFocusTrap()
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []

    // 1. Guests (VMs & LXCs)
    const guestItems = []
    for (const n of nodes ?? []) {
      const managed = n.managed !== false
      for (const vm of n.vms ?? []) {
        const link = serviceLinks[`qemu:${vm.vmid}`]
        const title = link?.label || vm.name
        const hay = `${title} ${vm.name} vm ${vm.vmid} ${n.id} ${(vm.tags ?? []).join(' ')}`.toLowerCase()
        if (!q || hay.includes(q)) {
          guestItems.push({
            key: `vm-${n.id}-${vm.vmid}`,
            group: 'Guests',
            label: title,
            sub: `VM ${vm.vmid} · ${n.id}${link?.url ? ' · Web UI' : ''}`,
            status: vm.status,
            icon: <IconMonitor size={15} />,
            run: () => {
              onClose()
              if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
              else onInspectGuest({ item: vm, type: 'VM', nodeName: n.id, managed })
            },
            inspect: () => {
              onClose()
              onInspectGuest({ item: vm, type: 'VM', nodeName: n.id, managed })
            },
            consoleHref: consoleUrl(pveURL, n.id, 'qemu', vm.vmid),
          })
        }
      }
      for (const ct of n.lxcs ?? []) {
        const link = serviceLinks[`lxc:${ct.vmid}`]
        const title = link?.label || ct.name
        const hay = `${title} ${ct.name} ct lxc ${ct.vmid} ${n.id} ${(ct.tags ?? []).join(' ')}`.toLowerCase()
        if (!q || hay.includes(q)) {
          guestItems.push({
            key: `ct-${n.id}-${ct.vmid}`,
            group: 'Guests',
            label: title,
            sub: `CT ${ct.vmid} · ${n.id}${link?.url ? ' · Web UI' : ''}`,
            status: ct.status,
            icon: <IconBox size={15} />,
            run: () => {
              onClose()
              if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
              else onInspectGuest({ item: ct, type: 'CT', nodeName: n.id, managed })
            },
            inspect: () => {
              onClose()
              onInspectGuest({ item: ct, type: 'CT', nodeName: n.id, managed })
            },
            consoleHref: consoleUrl(pveURL, n.id, 'lxc', ct.vmid),
          })
        }
      }
    }
    out.push(...guestItems.slice(0, q ? 12 : 6))

    // 2. Views / Pages
    for (const nav of NAV_COMMANDS) {
      if (!q || `${nav.label} ${nav.hint} ${nav.id}`.toLowerCase().includes(q)) {
        out.push({
          key: `nav-${nav.id}`,
          group: 'Navigate',
          label: nav.label,
          sub: nav.hint,
          icon: nav.icon,
          run: () => { onNavigate(nav.id); onClose() },
        })
      }
    }

    // 3. Themes (all 7 templates!)
    for (const t of THEMES) {
      if (!q || `theme template ${t.name} ${t.id} ${t.description}`.toLowerCase().includes(q)) {
        out.push({
          key: `theme-${t.id}`,
          group: 'Themes',
          label: `${t.name} theme`,
          sub: t.description,
          badge: theme === t.id ? 'Active' : null,
          swatch: THEME_SWATCHES[t.id],
          icon: <IconPalette size={15} />,
          run: () => { setTheme(t.id); onClose() },
        })
      }
    }

    // 4. Quick actions
    const actions = [
      {
        key: 'act-layout',
        group: 'Actions',
        label: guestLayout === 'grid' ? 'Switch guests to List view' : 'Switch guests to Grid view',
        sub: 'Change Dashboard guest layout density',
        icon: <IconList size={15} />,
        run: () => { onToggleLayout(); onClose() },
      },
      {
        key: 'act-running',
        group: 'Actions',
        label: runningOnly ? 'Show all guests (including stopped)' : 'Filter to running guests only',
        sub: 'Toggle Dashboard guest status filter',
        icon: <IconGrid size={15} />,
        run: () => { onToggleRunning(); onClose() },
      },
      {
        key: 'act-logout',
        group: 'Actions',
        label: 'Sign out',
        sub: 'End your current dashboard session',
        icon: <IconLogout size={15} />,
        run: () => { onClose(); onLogout() },
      },
    ]
    for (const a of actions) {
      if (!q || `${a.label} ${a.sub}`.toLowerCase().includes(q)) out.push(a)
    }

    return out
  }, [query, nodes, serviceLinks, pveURL, theme, setTheme, onNavigate, onInspectGuest, onClose, guestLayout, onToggleLayout, runningOnly, onToggleRunning, onLogout])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(i => (items.length ? (i + 1) % items.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(i => (items.length ? (i - 1 + items.length) % items.length : 0))
      } else if (e.key === 'Enter' && items[selectedIdx]) {
        e.preventDefault()
        items[selectedIdx].run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, items, selectedIdx, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!open) return null

  let lastGroup = null

  return (
    <div
      data-lenis-prevent
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 backdrop-blur-sm p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="cmd-palette bg-[#13131e] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.07]">
          <span className="text-gray-500"><IconSearch size={16} /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to a VM, container, page, or theme…"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
          />
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/8 text-gray-400">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} data-lenis-prevent className="overflow-y-auto p-2 flex-1">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No matching guests, views, or themes.</p>
          ) : (
            items.map((item, idx) => {
              const showGroup = item.group !== lastGroup
              lastGroup = item.group
              const active = idx === selectedIdx
              return (
                <div key={item.key}>
                  {showGroup && (
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      {item.group}
                    </p>
                  )}
                  <div
                    data-selected={active ? 'true' : undefined}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={item.run}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${
                      active ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    {item.swatch ? (
                      <span
                        className="w-4 h-4 rounded-full border border-white/20 shrink-0"
                        style={{ background: item.swatch }}
                      />
                    ) : (
                      <span className="text-gray-400 shrink-0">{item.icon}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      <p className="text-[11px] text-gray-500 truncate">{item.sub}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.status && (
                        <StatusPill variant={statusVariant(item.status)}>{item.status}</StatusPill>
                      )}
                      {item.badge && (
                        <StatusPill variant="success">{item.badge}</StatusPill>
                      )}
                      {item.inspect && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); item.inspect() }}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-white/8 text-gray-300 hover:text-white transition-colors"
                        >
                          Inspect
                        </button>
                      )}
                      {item.consoleHref && (
                        <a
                          href={item.consoleHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/8 text-gray-300 hover:text-white transition-colors"
                          title="Proxmox console"
                        >
                          <IconTerminal size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-gray-500">
          <div className="flex items-center gap-3">
            <span><kbd className="font-mono px-1 rounded bg-white/8">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono px-1 rounded bg-white/8">↵</kbd> select</span>
          </div>
          <span><kbd className="font-mono px-1 rounded bg-white/8">⌘K</kbd> / <kbd className="font-mono px-1 rounded bg-white/8">Ctrl+K</kbd></span>
        </div>
      </div>
    </div>
  )
}
