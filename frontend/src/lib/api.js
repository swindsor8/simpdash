const BASE = '/api'

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
