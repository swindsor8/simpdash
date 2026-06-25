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

export function runScript(node, slug) {
  // post() prepends BASE (/api); nodeBase(node) without that prefix is '' (local)
  // or '/nodes/:id' (secondary).
  const rel = nodeBase(node).slice(BASE.length)
  return post(`${rel}/catalog/${encodeURIComponent(slug)}/run`)
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
