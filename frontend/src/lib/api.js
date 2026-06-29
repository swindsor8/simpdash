const BASE = '/api'

// nodeBase routes a request at either the local host (`/api`) or a paired
// secondary, which main proxies (`/api/nodes/:id`). Pass node=null for local.
export const nodeBase = (node) => (node ? `/api/nodes/${encodeURIComponent(node)}` : '/api')

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json().catch(() => null)
}

export async function getSetupStatus() {
  const r = await fetch(`${BASE}/setup/status`)
  return r.json()
}

export const setupPassword = (password) => post('/setup/password', { password })
export const login = (password) => post('/auth/login', { password })

export async function logout() {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' })
}

export async function getMe() {
  const r = await fetch(`${BASE}/auth/me`, { credentials: 'same-origin' })
  return r.ok
}

// getUpdateCheck → { current_version, latest_version, update_available }.
export async function getUpdateCheck() {
  const r = await fetch(`${BASE}/update-check`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// The data helpers below take an optional `node` (paired node id, or null for
// the local host) so the same dashboard/scripts/updates views can target a
// secondary — main proxies the request.

export async function checkUpdates(node) {
  const r = await fetch(`${nodeBase(node)}/updates/check`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function applyUpdates(node) {
  const r = await fetch(`${nodeBase(node)}/updates/apply`, { method: 'POST', credentials: 'same-origin' })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

// updateContainer → starts an apt upgrade inside a local LXC (pct exec) and
// returns { job_id } for streaming. Containers only, local host only.
export async function updateContainer(vmid) {
  const r = await fetch(`${BASE}/guests/${vmid}/update`, { method: 'POST', credentials: 'same-origin' })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

export async function getJobs() {
  const r = await fetch(`${BASE}/jobs`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function getCatalog(node) {
  const r = await fetch(`${nodeBase(node)}/catalog`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// syncCatalog pulls scripts added upstream into the catalog. Main-node only —
// the overlay it writes lives on the main host.
export const syncCatalog = () => post('/catalog/sync')

export function runScript(node, slug, target) {
  // post() prepends BASE (/api); nodeBase(node) without that prefix is '' (local)
  // or '/nodes/:id' (secondary). target (an LXC vmid) is for add-on scripts that
  // install into an existing container; omit/"host" runs on the Proxmox host.
  const rel = nodeBase(node).slice(BASE.length)
  const q = target && target !== 'host' ? `?target=${encodeURIComponent(target)}` : ''
  return post(`${rel}/catalog/${encodeURIComponent(slug)}/run${q}`)
}

// getNetwork → PVE host network interfaces.
export async function getNetwork() {
  const r = await fetch(`${BASE}/network`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// getNetworkStats → raw RX/TX byte counters per interface from /proc/net/dev.
export async function getNetworkStats() {
  const r = await fetch(`${BASE}/network/stats`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// runSpeedtest → download/upload/ping from speedtest-cli. Takes ~15-30 s.
export async function runSpeedtest() {
  const r = await fetch(`${BASE}/network/speedtest`, { method: 'POST', credentials: 'same-origin' })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

// getSpeedtestHistory → last ~50 stored speed-test results.
export async function getSpeedtestHistory() {
  const r = await fetch(`${BASE}/network/speedtest/history`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// getConnectivity → WAN IP, DNS servers, gateway + internet reachability.
export async function getConnectivity() {
  const r = await fetch(`${BASE}/network/connectivity`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// getBackups → { guests: [...], jobs: [...] } — per-guest last-backup status
// and recent vzdump job results for the local PVE cluster.
export async function getBackups() {
  const r = await fetch(`${BASE}/backups`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// getGuestServices → running systemd services inside a guest. type is 'lxc'
// (pct exec) or 'qemu' (qm guest exec, needs the QEMU guest agent). Local host
// only for now.
export async function getGuestServices(vmid, type) {
  const r = await fetch(`${BASE}/guests/${vmid}/services?type=${type}`, { credentials: 'same-origin' })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

// --- lab notebook ---

// getNotes → Note[]. Optional { entityType, entityId, q } narrow server-side;
// the Notebook also filters client-side, so these are optional.
export async function getNotes({ entityType, entityId, q } = {}) {
  const p = new URLSearchParams()
  if (entityType) p.set('entity_type', entityType)
  if (entityId) p.set('entity_id', entityId)
  if (q) p.set('q', q)
  const qs = p.toString()
  const r = await fetch(`${BASE}/notes${qs ? `?${qs}` : ''}`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export const createNote = (note) => post('/notes', note)

export async function updateNote(id, patch) {
  const r = await fetch(`${BASE}/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

export async function deleteNote(id) {
  const r = await fetch(`${BASE}/notes/${id}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

// getNoteCounts → { entity_type, entity_id, count }[] for tile badges.
export async function getNoteCounts() {
  const r = await fetch(`${BASE}/notes/counts`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// getInfo → { self_node: string } — backend's own Proxmox node name.
export async function getInfo() {
  const r = await fetch(`${BASE}/info`, { credentials: 'same-origin' })
  if (!r.ok) return null
  return r.json().catch(() => null)
}

// entityAction — power action on a node, VM, or LXC.
// type: "node"|"qemu"|"lxc"; id: node name or vmid string; node: PVE node name (required for qemu/lxc)
export async function entityAction(type, id, node, action) {
  const r = await fetch(`${BASE}/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(node ? { node } : {}) }),
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

// --- service links ---

export async function getServiceLinks() {
  const r = await fetch(`${BASE}/service-links`, { credentials: 'same-origin' })
  if (!r.ok) return {}
  return r.json().catch(() => ({}))
}

export async function upsertServiceLink(type, id, url, label) {
  const r = await fetch(`${BASE}/service-links/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, label: label || null }),
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

export async function deleteServiceLink(type, id) {
  const r = await fetch(`${BASE}/service-links/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}

// --- paired secondary nodes (Milestone 5) ---

export async function getNodes() {
  const r = await fetch(`${BASE}/nodes`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export const pairNode = (address, code) => post('/nodes/pair', { address, code })

export async function unpairNode(id) {
  const r = await fetch(`${BASE}/nodes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(error || r.statusText)
  }
  return r.json()
}
