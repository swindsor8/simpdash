import { useState, useEffect, useMemo, useRef } from 'react'
import { serviceIconUrl } from '../lib/api'
import { Card, StatusPill, statusVariant } from './Card'
import RadialGauge from './RadialGauge'
import { BackupBadge } from './Backups'
import ServiceLinkEditor from './ServiceLinkEditor'
import {
  IconMonitor, IconBox, IconTerminal, IconGear, IconExternalLink,
  IconUpdateSm, IconNoteSm, IconSliders,
} from './Icons'
import { usePowerMorph, useStatusGlow, usePopPulse } from './motion'
import { copy } from '../lib/copy'
import { cardA11y } from '../lib/a11y'

// consoleUrl deep-links to the PVE web UI's noVNC/xterm console for a guest.
export function consoleUrl(pveURL, node, pxType, vmid) {
  let host = ''
  try { host = new URL(pveURL).host } catch { /* fall through */ }
  if (!host || /^(127\.|localhost)/.test(host)) host = `${window.location.hostname}:8006`
  const ct = pxType === 'qemu' ? 'kvm' : 'lxc'
  return `https://${host}/?console=${ct}&novnc=1&vmid=${vmid}&node=${encodeURIComponent(node)}`
}

export function HealthDot({ health }) {
  if (!health) return null
  return (
    <span
      title={health.up ? `Service up · HTTP ${health.status} · ${health.latency_ms} ms` : 'Service unreachable'}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${health.up ? 'bg-emerald-400' : 'bg-red-400'}`}
    />
  )
}

export function ServiceIcon({ entityType, entityId, hasLink, name, fallback, sizeClass = 'w-6 h-6' }) {
  const sources = useMemo(() => {
    const out = []
    if (hasLink) out.push(serviceIconUrl(entityType, entityId))
    const slug = (name || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (slug) out.push(`https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`)
    return out
  }, [entityType, entityId, hasLink, name])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [sources])
  if (idx >= sources.length) return fallback
  return (
    <img
      src={sources[idx]}
      alt=""
      loading="lazy"
      className={`${sizeClass} rounded object-contain`}
      onError={() => setIdx(i => i + 1)}
    />
  )
}

export function TagPill({ tag, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
        active
          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
          : 'bg-white/5 text-gray-500 hover:text-gray-300 border border-transparent'
      }`}
    >
      #{tag}
    </button>
  )
}

export function CompactGauge({ name, ...rest }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <RadialGauge size="sm" {...rest} />
      <span className="text-[9px] font-medium uppercase tracking-wider text-gray-500">{name}</span>
    </div>
  )
}

function pctTone(pct) {
  if (pct >= 85) return 'bg-red-400/80'
  if (pct >= 65) return 'bg-amber-400/80'
  return 'bg-emerald-400/75'
}

// GuestCard — rich elevated service card (Grid view). Preserves RadialGauge so
// Terminal's monochrome analog dials stay authentic.
export function GuestCard({
  item,
  type,
  nodeName,
  managed = true,
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
  onInspect,
  onTagClick,
  activeTag,
}) {
  const running = item.status === 'running'
  const etype = type === 'VM' ? 'vm' : 'lxc'
  const pxType = type === 'VM' ? 'qemu' : 'lxc'
  const justDone = usePowerMorph(isInflight)
  const glow = useStatusGlow(item.status)
  const [showEditor, setShowEditor] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(null)
  const copyBtnRef = useRef(null)
  usePopPulse(copyBtnRef, copied)

  const displayName = link?.label || item.name
  const key = `${pxType}:${item.vmid}`
  const health = healthMap?.[key]
  const ip = ips?.[key]?.[0]

  function handleCardClick() {
    if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
  }

  function copyIP(e) {
    e.stopPropagation()
    navigator.clipboard?.writeText(ip).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }

  const act = (action) => {
    setPending(action)
    onAction({ entityType: pxType, entityId: String(item.vmid), entityNode: nodeName, action })
  }

  return (
    <Card
      spotlight
      data-reveal=""
      className={`relative p-4 flex flex-col card-lift hover:border-white/20 ${glow || ''} ${link ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      {...cardA11y(link ? handleCardClick : null, `Open ${displayName}`)}
    >
      {/* Top-right tools: health dot, ext-link cue, inspect drawer trigger, link gear */}
      <div className="absolute top-3 right-3 flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {link && <HealthDot health={health} />}
        {link && <span className="ext-cue text-gray-500 opacity-60 px-0.5" title="Has a service link"><IconExternalLink /></span>}
        <button
          type="button"
          onClick={() => onInspect?.({ item, type, nodeName, managed })}
          className="text-gray-500 hover:text-gray-200 p-1 rounded-md hover:bg-white/5 transition-colors"
          title="Inspect guest details, Docker & services"
        >
          <IconSliders size={13} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowEditor(v => !v)}
            className="gear-btn text-gray-500 hover:text-gray-200 p-1 rounded-md hover:bg-white/5 transition-colors"
            title="Edit service link"
          >
            <IconGear size={13} />
          </button>
          {showEditor && (
            <ServiceLinkEditor
              entityType={pxType} entityId={String(item.vmid)} link={link}
              onDone={onServiceLinkChange} onClose={() => setShowEditor(false)}
            />
          )}
        </div>
      </div>

      {/* Identity */}
      <div className="flex items-center gap-2.5 mb-3 pr-16">
        <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/[0.06] flex items-center justify-center shrink-0 text-gray-400">
          <ServiceIcon
            entityType={pxType} entityId={String(item.vmid)} hasLink={!!link?.url} name={item.name}
            fallback={type === 'VM' ? <IconMonitor size={17} /> : <IconBox size={17} />}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white tracking-tight truncate">{displayName}</h3>
          <p className="text-[11px] text-gray-500 font-mono flex items-center gap-1.5">
            <span>{type}{item.vmid}</span>
            {ip && (
              <button
                ref={copyBtnRef}
                type="button"
                onClick={copyIP}
                title="Copy IP address"
                className="text-gray-500 hover:text-gray-200 transition-colors inline-block truncate"
              >
                {copied ? 'copied' : ip}
              </button>
            )}
          </p>
        </div>
      </div>

      {/* Status + backup + notes + tags */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <StatusPill variant={statusVariant(item.status)}>{item.status}</StatusPill>
        <BackupBadge backup={backup} />
        {noteCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenNotes(etype, String(item.vmid)) }}
            title={`${noteCount} note${noteCount !== 1 ? 's' : ''} — open notebook`}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-gray-400 hover:bg-white/15 transition-colors"
          >
            <IconNoteSm /> {noteCount}
          </button>
        )}
        {(item.tags ?? []).map(t => (
          <span key={t} onClick={e => e.stopPropagation()}>
            <TagPill tag={t} active={activeTag === t} onClick={() => onTagClick?.(t)} />
          </span>
        ))}
      </div>

      {/* Extra service links */}
      {link?.extras?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3" onClick={e => e.stopPropagation()}>
          {link.extras.map((x, i) => {
            let host = x.url
            try { host = new URL(x.url).host } catch { /* keep raw */ }
            return (
              <a
                key={i}
                href={x.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors"
              >
                <HealthDot health={healthMap?.[`${key}#${i}`]} />
                {x.label || host}
              </a>
            )
          })}
        </div>
      )}

      {/* Compact CPU / RAM / Disk gauges */}
      <div className="flex items-start justify-around gap-1 mb-3.5" onClick={e => e.stopPropagation()}>
        <CompactGauge name="CPU" value={item.cpu} max={1} idle={!running} />
        <CompactGauge name="RAM" value={item.mem} max={item.maxmem} idle={!running} />
        <CompactGauge name="Disk" value={item.disk} max={item.maxdisk} idle={!running} />
      </div>

      {/* Footer actions */}
      <div className="mt-auto pt-2.5 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isInflight ? (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500 animate-fade-in">
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              {copy(pending ? `action.${pending}` : 'action.working', 'Working…')}
            </span>
          ) : justDone ? (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 animate-fade-in">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Done
            </span>
          ) : running ? (
            <>
              <button type="button" onClick={() => act('shutdown')} className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                Shutdown
              </button>
              <button type="button" onClick={() => act('reboot')} className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                Reboot
              </button>
              {onUpdate && (
                <button type="button" onClick={() => onUpdate(item)} title="Update packages inside container" className="text-[11px] px-1.5 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                  <IconUpdateSm />
                </button>
              )}
              <a
                href={consoleUrl(pveURL, nodeName, pxType, item.vmid)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open console in the Proxmox web UI"
                className="text-[11px] px-1.5 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconTerminal size={13} />
              </a>
              <button type="button" onClick={() => act('stop')} className="ml-auto text-[11px] text-gray-500 hover:text-red-400 transition-colors" title="Force stop — equivalent to pulling the power">
                Force stop
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => act('start')} className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-medium transition-colors">
                Start
              </button>
              <button
                type="button"
                onClick={() => onInspect?.({ item, type, nodeName, managed })}
                className="ml-auto text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                Details
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

// GuestRow — high-density scannable row for List view mode.
export function GuestRow({
  item,
  type,
  nodeName,
  managed = true,
  backup,
  noteCount,
  onOpenNotes,
  link,
  isInflight,
  onAction,
  onUpdate,
  ips,
  healthMap,
  pveURL,
  onInspect,
}) {
  const running = item.status === 'running'
  const etype = type === 'VM' ? 'vm' : 'lxc'
  const pxType = type === 'VM' ? 'qemu' : 'lxc'
  const displayName = link?.label || item.name
  const key = `${pxType}:${item.vmid}`
  const health = healthMap?.[key]
  const ip = ips?.[key]?.[0]
  const cpuPct = running ? Math.min(100, (item.cpu || 0) * 100) : 0
  const memPct = running && item.maxmem > 0 ? Math.min(100, (item.mem / item.maxmem) * 100) : 0

  const act = (action) => onAction({ entityType: pxType, entityId: String(item.vmid), entityNode: nodeName, action })

  return (
    <div
      onClick={() => onInspect?.({ item, type, nodeName, managed })}
      className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
    >
      {/* Icon + identity */}
      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/[0.06] flex items-center justify-center shrink-0 text-gray-400">
        <ServiceIcon
          entityType={pxType} entityId={String(item.vmid)} hasLink={!!link?.url} name={item.name}
          fallback={type === 'VM' ? <IconMonitor size={15} /> : <IconBox size={15} />}
          sizeClass="w-5 h-5"
        />
      </div>

      <div className="min-w-0 flex-1 sm:max-w-[240px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium text-white truncate">{displayName}</span>
          {link && <HealthDot health={health} />}
        </div>
        <div className="text-[11px] font-mono text-gray-500 flex items-center gap-2 truncate">
          <span>{type}{item.vmid}</span>
          {ip && <span>{ip}</span>}
        </div>
      </div>

      {/* Status + backup + notes */}
      <div className="hidden md:flex items-center gap-1.5 shrink-0 w-40" onClick={e => e.stopPropagation()}>
        <StatusPill variant={statusVariant(item.status)}>{item.status}</StatusPill>
        <BackupBadge backup={backup} />
        {noteCount > 0 && (
          <button
            type="button"
            onClick={() => onOpenNotes(etype, String(item.vmid))}
            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/8 text-gray-400 hover:bg-white/15"
            title="Open notes"
          >
            <IconNoteSm /> {noteCount}
          </button>
        )}
      </div>

      {/* Inline CPU / RAM meters */}
      <div className="hidden lg:flex items-center gap-4 flex-1 justify-end max-w-xs">
        <div className="w-24">
          <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
            <span>CPU</span>
            <span className="tabular-nums text-gray-300">{running ? `${cpuPct.toFixed(0)}%` : '—'}</span>
          </div>
          <div className="h-1 rounded-full bg-white/8 overflow-hidden">
            <div className={`h-full rounded-full bar-fill ${pctTone(cpuPct)}`} style={{ width: `${cpuPct}%` }} />
          </div>
        </div>
        <div className="w-24">
          <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
            <span>RAM</span>
            <span className="tabular-nums text-gray-300">{running ? `${memPct.toFixed(0)}%` : '—'}</span>
          </div>
          <div className="h-1 rounded-full bg-white/8 overflow-hidden">
            <div className={`h-full rounded-full bar-fill ${pctTone(memPct)}`} style={{ width: `${memPct}%` }} />
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
        {link?.url && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${displayName}`}
            className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <IconExternalLink size={12} />
          </a>
        )}
        {isInflight ? (
          <svg className="animate-spin text-gray-500 mx-2" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        ) : running ? (
          <>
            {onUpdate && (
              <button type="button" onClick={() => onUpdate(item)} title="Update container packages" className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                <IconUpdateSm size={12} />
              </button>
            )}
            <a
              href={consoleUrl(pveURL, nodeName, pxType, item.vmid)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open Proxmox console"
              className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <IconTerminal size={12} />
            </a>
            <button type="button" onClick={() => act('reboot')} className="hidden sm:inline-block text-[11px] px-2 py-1 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
              Reboot
            </button>
            <button type="button" onClick={() => act('shutdown')} className="hidden sm:inline-block text-[11px] px-2 py-1 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
              Stop
            </button>
          </>
        ) : (
          <button type="button" onClick={() => act('start')} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-medium transition-colors">
            Start
          </button>
        )}
        <button
          type="button"
          onClick={() => onInspect?.({ item, type, nodeName, managed })}
          title="Inspect guest"
          className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <IconSliders size={12} />
        </button>
      </div>
    </div>
  )
}
