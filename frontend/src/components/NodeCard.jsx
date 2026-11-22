import { useState } from 'react'
import { Card, StatusPill, statusVariant } from './Card'
import RadialGauge from './RadialGauge'
import NodeTrends from './NodeTrends'
import ServiceLinkEditor from './ServiceLinkEditor'
import { IconServer, IconEye, IconGear, IconExternalLink } from './Icons'
import { usePowerMorph, useStatusGlow, Expandable } from './motion'
import { copy } from '../lib/copy'
import { cardA11y } from '../lib/a11y'

// fmtPair — "8.8 / 34 GB": used/total in a single unit, for gauge captions.
export function fmtPair(a, b) {
  if (!b) return '—'
  const gb = b >= 1e9
  const div = gb ? 1e9 : 1e6
  const f = (n) => { const v = n / div; return v >= 100 ? Math.round(v) : v.toFixed(1) }
  return `${f(a)} / ${f(b)} ${gb ? 'GB' : 'MB'}`
}

export function fmtUptime(s) {
  if (!s) return '0h'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h`
}

export function MonitorOnlyBadge() {
  return (
    <StatusPill variant="warning"><IconEye /> {copy('badge.monitor', 'Monitor only')}</StatusPill>
  )
}

export function NodeGauge({ name, ...rest }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{name}</span>
      <RadialGauge size="lg" {...rest} />
    </div>
  )
}

function StorageBar({ pool }) {
  const pct = pool.maxdisk > 0 ? (pool.disk / pool.maxdisk) * 100 : 0
  const hot = pct >= 90
  const warm = pct >= 75
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="text-[11px] font-mono text-gray-400 truncate w-28 shrink-0" title={pool.id}>
        {pool.id}{pool.shared ? ' ·s' : ''}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden min-w-[3rem]">
        <div
          className={`h-full rounded-full bar-fill ${hot ? 'bg-red-400/80' : warm ? 'bg-amber-400/80' : 'bg-blue-500'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={`text-[11px] font-mono tabular-nums w-28 text-right shrink-0 ${hot ? 'text-red-400' : warm ? 'text-amber-400' : 'text-gray-500'}`}>
        {pool.status !== 'available' ? pool.status : fmtPair(pool.disk, pool.maxdisk)}
      </span>
    </div>
  )
}

export default function NodeCard({
  node,
  selfNode,
  serviceLinks,
  onServiceLinkChange,
  inflight,
  onAction,
  onInstallAgent,
  localCluster,
}) {
  const monitorOnly = node.managed === false
  const online = node.status === 'online'
  const link = serviceLinks[`node:${node.id}`]
  const isInflight = !!inflight[`node:${node.id}`]
  const justDone = usePowerMorph(isInflight)
  const glow = useStatusGlow(node.status)
  const [showEditor, setShowEditor] = useState(false)
  const [showStorage, setShowStorage] = useState(false)

  function handleCardClick() {
    if (link?.url) window.open(link.url, '_blank', 'noopener noreferrer')
  }

  const storage = node.storage ?? []
  const worstStorage = storage.reduce((m, p) => Math.max(m, p.maxdisk > 0 ? p.disk / p.maxdisk : 0), 0)
  const runningVMs = (node.vms ?? []).filter(g => g.status === 'running').length
  const runningLXCs = (node.lxcs ?? []).filter(g => g.status === 'running').length

  return (
    <Card
      spotlight
      data-reveal=""
      className={`p-5 sm:p-6 relative card-lift hover:border-white/20 ${glow || ''} ${link ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      {...cardA11y(link ? handleCardClick : null, `Open ${link?.label || node.id}`)}
    >
      {/* Gear + external-link indicators */}
      <div className="absolute top-3.5 right-3.5 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        {link && <span className="ext-cue text-gray-500 opacity-60"><IconExternalLink /></span>}
        <div className="relative">
          <button
            onClick={() => setShowEditor(v => !v)}
            className="gear-btn text-gray-500 hover:text-gray-300 p-1 rounded-lg hover:bg-white/5 transition-colors"
            title="Edit service link"
          >
            <IconGear />
          </button>
          {showEditor && (
            <ServiceLinkEditor
              entityType="node" entityId={node.id} link={link}
              onDone={onServiceLinkChange} onClose={() => setShowEditor(false)}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Identity + metadata + power controls */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-4 gap-3 pr-10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/[0.06] flex items-center justify-center text-gray-400 shrink-0">
                <IconServer size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-white tracking-tight truncate">{node.id}</h2>
                  {node.id === selfNode && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/5 border border-white/[0.06] text-gray-500">
                      local
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">
                  up {fmtUptime(node.uptime)} · {node.maxcpu} vCPU · {runningVMs}/{(node.vms ?? []).length} VMs · {runningLXCs}/{(node.lxcs ?? []).length} CTs
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
              {monitorOnly && <MonitorOnlyBadge />}
              <StatusPill variant={statusVariant(node.status)}>{node.status}</StatusPill>
            </div>
          </div>

          {/* Node power controls */}
          <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
            {!online && (
              <button
                disabled={isInflight}
                onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'wake' })}
                title="Send a wake-on-LAN packet via the cluster (needs the WOL MAC set in this node's PVE options)"
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-medium transition-colors disabled:opacity-40"
              >
                Wake
              </button>
            )}
            <button
              disabled={isInflight || !online}
              onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'reboot', isSelf: node.id === selfNode })}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              Reboot
            </button>
            <button
              disabled={isInflight || !online}
              onClick={() => onAction({ entityType: 'node', entityId: node.id, action: 'shutdown', isSelf: node.id === selfNode })}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              Shutdown
            </button>
            {isInflight ? (
              <svg className="animate-spin text-gray-500 ml-1" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : justDone ? (
              <span className="ml-1 text-emerald-400 animate-fade-in" title="Done">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            ) : null}
            {monitorOnly && (
              <button
                onClick={onInstallAgent}
                className="ml-auto shrink-0 text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                Install agent
              </button>
            )}
          </div>
          {monitorOnly && (
            <p className="text-xs text-gray-500 mt-2">No SuperDash agent here — stats only.</p>
          )}
        </div>

        {/* CPU / Memory / Disk gauges (RadialGauge adapts to analog dials in Terminal) */}
        <div className="flex items-center justify-center gap-5 sm:gap-7 shrink-0 flex-wrap" onClick={e => e.stopPropagation()}>
          <NodeGauge name="CPU" value={node.cpu} max={1} label={`of ${node.maxcpu} cores`} format={n => `${n.toFixed(1)}%`} />
          <NodeGauge name="Memory" value={node.mem} max={node.maxmem} label={fmtPair(node.mem, node.maxmem)} />
          <NodeGauge name="Disk" value={node.disk} max={node.maxdisk} label={fmtPair(node.disk, node.maxdisk)} />
        </div>
      </div>

      {localCluster && <NodeTrends nodeId={node.id} online={online} />}

      {/* Storage pools */}
      {storage.length > 0 && (
        <div className="mt-5 pt-4 border-t border-white/[0.06]" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setShowStorage(v => !v)}
            aria-expanded={showStorage}
            className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className={`inline-block transition-transform ${showStorage ? 'rotate-90' : ''}`}>▸</span>
            Storage · {storage.length} pool{storage.length !== 1 ? 's' : ''}
            {worstStorage >= 0.9 && <StatusPill variant="error">{Math.round(worstStorage * 100)}% full</StatusPill>}
            {worstStorage >= 0.75 && worstStorage < 0.9 && <StatusPill variant="warning">{Math.round(worstStorage * 100)}% full</StatusPill>}
          </button>
          <Expandable open={showStorage}>
            <div className="mt-3 space-y-2">
              {[...storage]
                .sort((a, b) => (b.maxdisk ? b.disk / b.maxdisk : 0) - (a.maxdisk ? a.disk / a.maxdisk : 0))
                .map(p => <StorageBar key={p.id} pool={p} />)}
            </div>
          </Expandable>
        </div>
      )}
    </Card>
  )
}
