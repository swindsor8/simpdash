# API Contract

This is the source of truth for the HTTP/WebSocket surface between the React
frontend and the Go backend. Keep this in sync as routes get implemented —
both `internal/api` handlers and `frontend/src/lib/api.ts` should match this
exactly. Drift between this doc and reality is the #1 way these projects rot.

## Auth

Single local admin user, no multi-tenancy. Session via signed cookie (HMAC,
`SessionSecret` from config). No refresh tokens, no OAuth — see config.go
comment for reasoning.

| Method | Path           | Body                          | Notes                              |
|--------|----------------|--------------------------------|-------------------------------------|
| GET    | `/api/setup/status` | —                          | `{ "onboarded": bool, "mode": "main"|"secondary" }` |
| POST   | `/api/setup/password` | `{ "password": string }`  | First-run only. 412 if already onboarded. |
| POST   | `/api/auth/login`     | `{ "password": string }`  | Sets session cookie.               |
| POST   | `/api/auth/logout`    | —                          | Clears session cookie.             |
| GET    | `/api/auth/me`        | —                          | 200 if session valid, else 401.    |

## Proxmox / Resource Stats (Milestone 2)

| Method | Path                      | Notes |
|--------|---------------------------|-------|
| GET    | `/api/resources`          | Snapshot of `/cluster/resources`, reshaped — see schema below. |
| WS     | `/api/resources/stream`   | Pushes the same shape every N seconds (default 3s). Used for live dashboard updates instead of polling from the client. |

### Resource snapshot shape

```json
{
  "nodes": [
    {
      "id": "pve1",
      "status": "online",
      "cpu": 0.12,
      "maxcpu": 8,
      "mem": 8800000000,
      "maxmem": 34000000000,
      "disk": 340000000000,
      "maxdisk": 512000000000,
      "uptime": 1209600,
      "managed": true,
      "vms": [
        {
          "vmid": 101,
          "name": "jellyfin",
          "status": "running",
          "cpu": 0.04,
          "mem": 2100000000,
          "maxmem": 4000000000,
          "disk": null,
          "uptime": 86000
        }
      ],
      "lxcs": [
        {
          "vmid": 201,
          "name": "pihole",
          "status": "running",
          "cpu": 0.01,
          "mem": 180000000,
          "maxmem": 512000000,
          "disk": 900000000,
          "maxdisk": 4000000000,
          "uptime": 86000
        }
      ]
    }
  ]
}
```

`managed: false` marks a node visible via the cluster API but without an
agent installed — frontend renders the "monitor only" badge from this flag
(see Milestone 5 design discussion).

## Updates (Milestone 3)

| Method | Path                  | Notes |
|--------|-----------------------|-------|
| GET    | `/api/updates/check`  | Runs `apt update`, returns pending package list. |
| POST   | `/api/updates/apply`  | Kicks off `apt upgrade -y` as a job. Returns `{ "job_id": string }` immediately. |
| WS     | `/api/jobs/:id/stream`| Streams stdout/stderr lines + final exit code for any job (updates or script installs share this). |
| GET    | `/api/jobs`           | Job history from SQLite (id, type, status, started_at, finished_at, exit_code). |
| GET    | `/api/jobs/:id`       | Full log + metadata for one job. |

### Job stream message shape (WS, one JSON object per line)

```json
{ "type": "stdout", "line": "Reading package lists... Done" }
{ "type": "stderr", "line": "W: some warning" }
{ "type": "done", "exit_code": 0 }
```

Only one privileged job (update or script install) may run at a time —
`POST` to start a job returns 409 if another job is already in flight.
This is enforced by a mutex/lock in `internal/executor`, not just a UI
disable-the-button convention, since the UI shouldn't be the only thing
preventing two root shells from racing.

## Script Catalog (Milestone 4)

| Method | Path                    | Notes |
|--------|-------------------------|-------|
| GET    | `/api/catalog`          | Returns the parsed manifest from `catalog/manifest.yaml`. |
| POST   | `/api/catalog/:slug/run`| Same job semantics as updates — returns `{ "job_id": string }`, streamed via `/api/jobs/:id/stream`. |

## Secondary Node Pairing (Milestone 5)

These run on the **secondary** agent's own API (different port/process from
Main, but same binary):

| Method | Path           | Body                         | Notes |
|--------|----------------|-------------------------------|-------|
| GET    | `/agent/status`| —                             | `{ "paired": bool, "hostname": string }` |
| POST   | `/agent/pair`  | `{ "pairing_code": string }`  | One-time use. Returns `{ "auth_token": string }` on success, 403 on bad/expired code. |

These run on the **main** node, calling out to secondaries:

| Method | Path                          | Body | Notes |
|--------|-------------------------------|------|-------|
| POST   | `/api/nodes/secondary`        | `{ "address": string, "pairing_code": string }` | Performs the pairing handshake, stores the returned token. |
| GET    | `/api/nodes`                  | —    | Lists all known secondaries + their reachability. |
| DELETE | `/api/nodes/:id`               | —    | Unpair / forget a secondary. |

Commands to secondaries (run update, run script) get proxied through Main's
existing `/api/updates/*` and `/api/catalog/*` routes with a `?node=<id>`
query param — frontend doesn't need a separate code path per node, Main's
backend just forwards the executor call over the secondary's authenticated
agent API instead of running it locally.
