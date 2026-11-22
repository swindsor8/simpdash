import { useState, useEffect, useCallback, useMemo } from 'react'
import { getGuestServices, getGuestDocker } from '../lib/api'
import { StatusPill, statusVariant } from './Card'
import RadialGauge from './RadialGauge'
import { BackupBadge } from './Backups'
import ServiceLinkEditor from './ServiceLinkEditor'
import { ServiceIcon, HealthDot, TagPill, consoleUrl } from './GuestCard'
import { fmtPair, fmtUptime } from './NodeCard'
import {
  IconMonitor, IconBox, IconTerminal, IconExternalLink,
  IconUpdateSm, IconNoteSm, IconGear, IconSearch,
} from './Icons'
import { useFocusTrap } from '../lib/a11y'

// GuestDrawer — theme-aware slide-over inspector for any VM or LXC container:
// live metrics, power/package actions, service link editor, backup & notes,
// plus live Docker containers and searchable systemd services.
export default function GuestDrawer({
  guest,
  onClose,
  backup,
  noteCount,
  onOpenNotes,
  link,
  onServiceLinkChange,
  isInflight,
  onAction,
  onUpdate,
  ips,
  healthMap,
  pveURL,
  canInspect,
  onTagClick,
}) {
  const trap = useFocusTrap()
  const [editingLink, setEditingLink] = useState(false)
  const [copied, setCopied] = useState(false)
  const [services, setServices] = useState(null)
  const [docker, setDocker] = useState(null)
  const [svcFilter, setSvcFilter] = useState('')
  const [loadingRuntime, setLoadingRuntime] = useState(false)

  const item = guest?.item
  const type = guest?.type
  const nodeName = guest?.nodeName
  const managed = guest?.managed !== false
  const running = item?.status === 'running'
  const etype = type === 'VM' ? 'vm' : 'lxc'
  const pxType = type === 'VM' ? 'qemu' : 'lxc'
  const vmidStr = item ? String(item.vmid) : ''

  useEffect(() => {
    if (!guest) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guest, onClose])

  const loadRuntime = useCallback(() => {
    if (!item || !running || !canInspect) return
    let live = true
    setLoadingRuntime(true)
    Promise.allSettled([
      getGuestServices(vmidStr, pxType),
      getGuestDocker(vmidStr, pxType),
    ]).then(([svcRes, docRes]) => {
      if (!live) return
      if (svcRes.status === 'fulfilled') setServices(svcRes.value)
      else setServices({ err: svcRes.reason?.message || 'Unavailable' })
      if (docRes.status === 'fulfilled') setDocker(docRes.value)
      else setDocker({ err: true })
      setLoadingRuntime(false)
    })
    return () => { live = false }
  }, [item, running, canInspect, vmidStr, pxType])

  useEffect(() => {
    setEditingLink(false)
    setSvcFilter('')
    setServices(null)
    setDocker(null)
    if (item && running && canInspect) return loadRuntime()
  }, [vmidStr, pxType, running, canInspect, loadRuntime])

  const filteredServices = useMemo(() => {
    if (!Array.isArray(services)) return []
    const q = svcFilter.trim().toLowerCase()
    if (!q) return services
    return services.filter(s =>
      s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q),
    )
  }, [services, svcFilter])

  if (!guest || !item) return null

  const displayName = link?.label || item.name
  const key = `${pxType}:${item.vmid}`
  const health = healthMap?.[key]
  const allIPs = ips?.[key] ?? []
  const primaryIP = allIPs[0]

  function copyIP(ipVal) {
    navigator.clipboard?.writeText(ipVal).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }

  const act = (action) => onAction({ entityType: pxType, entityId: vmidStr, entityNode: nodeName, action })

  return (
    <div
      data-lenis-prevent
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${displayName}`}
        className="drawer-panel animate-drawer-in bg-[#13131e] border-l border-white/10 w-full max-w-md h-full flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/[0.06] flex items-center justify-center shrink-0 text-gray-400">
              <ServiceIcon
                entityType={pxType} entityId={vmidStr} hasLink={!!link?.url} name={item.name}
                fallback={type === 'VM' ? <IconMonitor size={18} /> : <IconBox size={18} />}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white tracking-tight truncate">{displayName}</h2>
                {link && <HealthDot health={health} />}
              </div>
              <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                {type} {item.vmid} · {nodeName}
                {link?.label && link.label !== item.name ? ` · ${item.name}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors text-sm shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div data-lenis-prevent className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Status & metadata strip */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill variant={statusVariant(item.status)}>{item.status}</StatusPill>
            <BackupBadge backup={backup} />
            {running && item.uptime > 0 && (
              <StatusPill variant="neutral">up {fmtUptime(item.uptime)}</StatusPill>
            )}
            {item.maxcpu > 0 && (
              <StatusPill variant="neutral">{item.maxcpu} vCPU</StatusPill>
            )}
            {primaryIP && (
              <button
                type="button"
                onClick={() => copyIP(primaryIP)}
                title="Click to copy IP address"
                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/8 text-gray-300 hover:bg-white/10 transition-colors"
              >
                {copied ? 'Copied!' : primaryIP}
              </button>
            )}
          </div>

          {/* Resource Gauges */}
          <div className="bg-[#0c0c14] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center justify-around gap-2 flex-wrap">
              <div className="flex flex-col items-center gap-1">
                <RadialGauge size="lg" value={item.cpu} max={1} idle={!running} label={item.maxcpu ? `${item.maxcpu} cores` : ''} format={n => `${n.toFixed(1)}%`} />
                <span className="text-[10px] uppercase tracking-wider text-gray-500">CPU</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <RadialGauge size="lg" value={item.mem} max={item.maxmem} idle={!running} label={fmtPair(item.mem, item.maxmem)} />
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Memory</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <RadialGauge size="lg" value={item.disk} max={item.maxdisk} idle={!running} label={item.maxdisk > 0 ? fmtPair(item.disk, item.maxdisk) : 'N/A'} />
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Disk</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Actions</p>
            <div className="flex flex-wrap gap-2">
              {running ? (
                <>
                  <button
                    type="button"
                    disabled={isInflight}
                    onClick={() => act('shutdown')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
                  >
                    Shutdown
                  </button>
                  <button
                    type="button"
                    disabled={isInflight}
                    onClick={() => act('reboot')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
                  >
                    Reboot
                  </button>
                  <button
                    type="button"
                    disabled={isInflight}
                    onClick={() => act('stop')}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                  >
                    Force stop
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isInflight}
                  onClick={() => act('start')}
                  className="text-xs px-3.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-medium disabled:opacity-40 transition-colors"
                >
                  Start guest
                </button>
              )}

              {type === 'CT' && running && managed && onUpdate && (
                <button
                  type="button"
                  onClick={() => onUpdate(item)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors"
                >
                  <IconUpdateSm size={12} /> Update packages
                </button>
              )}

              <a
                href={consoleUrl(pveURL, nodeName, pxType, item.vmid)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconTerminal size={12} /> Console
              </a>

              <button
                type="button"
                onClick={() => { onOpenNotes(etype, vmidStr); onClose() }}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconNoteSm /> Notes{noteCount > 0 ? ` (${noteCount})` : ''}
              </button>
            </div>
          </div>

          {/* Service Links */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Web Services</p>
              <button
                type="button"
                onClick={() => setEditingLink(v => !v)}
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
              >
                <IconGear size={12} /> {editingLink ? 'Close editor' : link ? 'Edit links' : 'Add service link'}
              </button>
            </div>

            {editingLink ? (
              <ServiceLinkEditor
                inline
                entityType={pxType}
                entityId={vmidStr}
                link={link}
                onDone={onServiceLinkChange}
                onClose={() => setEditingLink(false)}
              />
            ) : link?.url ? (
              <div className="space-y-1.5">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#0c0c14] border border-white/[0.06] hover:border-white/20 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <HealthDot health={health} />
                    <span className="text-xs font-medium text-white truncate">{link.label || link.url}</span>
                  </span>
                  <span className="text-gray-500 shrink-0"><IconExternalLink size={12} /></span>
                </a>
                {(link.extras ?? []).map((x, i) => (
                  <a
                    key={i}
                    href={x.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#0c0c14] border border-white/[0.06] hover:border-white/20 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <HealthDot health={healthMap?.[`${key}#${i}`]} />
                      <span className="text-xs text-gray-300 truncate">{x.label || x.url}</span>
                    </span>
                    <span className="text-gray-500 shrink-0"><IconExternalLink size={12} /></span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No web UI linked yet. Add a URL to turn this guest card into a 1-click launcher with health checks.</p>
            )}
          </div>

          {/* Tags */}
          {(item.tags ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Tags</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.tags.map(t => (
                  <TagPill key={t} tag={t} onClick={() => { onTagClick?.(t); onClose() }} />
                ))}
              </div>
            </div>
          )}

          {/* Runtime Inspection: Docker & Systemd */}
          {canInspect && running && (
            <div className="space-y-4 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Inside Guest</p>
                <button
                  type="button"
                  onClick={loadRuntime}
                  disabled={loadingRuntime}
                  className="text-xs text-gray-500 hover:text-gray-200 disabled:opacity-40 transition-colors"
                >
                  {loadingRuntime ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {/* Docker containers */}
              {Array.isArray(docker) && docker.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400">Docker Containers ({docker.length})</p>
                  <div className="bg-[#0c0c14] border border-white/[0.06] rounded-xl divide-y divide-white/[0.05] overflow-hidden">
                    {docker.map(c => (
                      <div key={c.name} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.state === 'running' ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                          <div className="min-w-0">
                            <p className="text-gray-200 font-medium truncate">{c.name}</p>
                            {c.image && <p className="text-[10px] font-mono text-gray-500 truncate">{c.image}</p>}
                          </div>
                        </div>
                        <StatusPill variant={c.state === 'running' ? 'success' : 'neutral'}>
                          {c.state}
                        </StatusPill>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Systemd services */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-400">
                    Systemd Services{Array.isArray(services) ? ` (${services.length})` : ''}
                  </p>
                </div>
                {services === null ? (
                  <p className="text-xs text-gray-500">Loading guest services…</p>
                ) : services.err ? (
                  <p className="text-xs text-gray-500">{services.err}</p>
                ) : services.length === 0 ? (
                  <p className="text-xs text-gray-500">No running systemd units reported.</p>
                ) : (
                  <div className="space-y-2">
                    {services.length > 6 && (
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
                          <IconSearch size={12} />
                        </span>
                        <input
                          value={svcFilter}
                          onChange={e => setSvcFilter(e.target.value)}
                          placeholder="Filter services…"
                          className="w-full bg-[#0c0c14] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
                        />
                      </div>
                    )}
                    <div className="bg-[#0c0c14] border border-white/[0.06] rounded-xl divide-y divide-white/[0.04] max-h-60 overflow-y-auto">
                      {filteredServices.map(s => (
                        <div key={s.name} className="px-3 py-2 flex items-start gap-2 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 mt-1.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-mono text-gray-200 truncate">{s.name}</p>
                            {s.description && <p className="text-[11px] text-gray-500 truncate">{s.description}</p>}
                          </div>
                        </div>
                      ))}
                      {filteredServices.length === 0 && (
                        <p className="px-3 py-4 text-center text-xs text-gray-500">No matching services.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
