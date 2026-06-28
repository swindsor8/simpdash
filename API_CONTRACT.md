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

`managed` (Milestone 6) marks whether SimpDash can act on a node: `true` for
the local host and paired secondaries, `false` for a node visible via the
cluster API but without an agent. The frontend renders the "monitor only"
badge + "Install agent" prompt from `managed: false`. Main sets this by
cross-referencing `/cluster/resources` node names against its own hostname and
each paired node's reported `node_name`.

## Backups (Milestone 8)

| Method | Path           | Notes |
|--------|----------------|-------|
| GET    | `/api/backups` | Per-guest last-backup status + recent vzdump job results for the local PVE cluster. Cached server-side 5 min. |

Per-guest age comes from each backup storage's content listing (newest file's
`ctime` per vmid). Pass/fail comes from each node's `vzdump` task log — PVE
reports backup success **per job, not per guest**, so a guest badge shows only
its last backup's age (or "no backup"); job failures surface in `jobs`.

Local cluster only (everything reachable via the main token); paired-agent
backups are not proxied yet. Uses the existing read-only token role
(`Sys.Audit` for tasks, `Datastore.Audit` for storage content) — no new privs.

```json
{
  "guests": [
    { "vmid": 101, "name": "jellyfin", "type": "qemu", "node": "pve1",
      "status": "running", "last_backup": 1719446400, "size": 8400000000 },
    { "vmid": 201, "name": "pihole", "type": "lxc", "node": "pve1",
      "status": "running", "last_backup": 0, "size": 0 }
  ],
  "jobs": [
    { "node": "pve1", "upid": "UPID:pve1:...", "status": "OK",
      "starttime": 1719446400, "endtime": 1719448200 }
  ]
}
```

`last_backup` is unix seconds, `0` when no backup file was found. A job
`status` of `"OK"` is success, `""` means still running, anything else is the
failure message.

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

Same binary, run with `mode: secondary`. The agent has **no UI and no session
auth**. On first boot (not yet paired) it prints a single-use, 15-minute
pairing code + its detected address to the log / `systemctl status`. The
pairing code IS the credential for `/agent/pair`; every other `/agent/*` route
requires the permanent token via `Authorization: Bearer <token>`.

These run on the **secondary** agent (port 7575 by default):

| Method | Path                        | Auth | Notes |
|--------|-----------------------------|------|-------|
| POST   | `/agent/pair`               | `Authorization: Bearer <pairing-code>` | One-time use. Returns `{ "token": string, "node": string }` (node = the secondary's hostname/PVE node name, stored by main for monitor-only cross-referencing); 401 on bad/expired/spent code. Persists the token and burns the code. |
| GET    | `/agent/resources`          | Bearer token | Same snapshot shape as `/api/resources`. |
| GET    | `/agent/updates/check`      | Bearer token | As `/api/updates/check`. |
| POST   | `/agent/updates/apply`      | Bearer token | As `/api/updates/apply` → `{ "job_id": string }`. |
| GET    | `/agent/catalog`            | Bearer token | As `/api/catalog`. |
| POST   | `/agent/catalog/:slug/run`  | Bearer token | As `/api/catalog/:slug/run` → `{ "job_id": string }`. |
| GET    | `/agent/jobs/:id`           | Bearer token | As `/api/jobs/:id`. |
| WS     | `/agent/jobs/:id/stream`    | Bearer token (handshake header) | As `/api/jobs/:id/stream`. |

These run on the **main** node (session-gated like the rest of `/api`):

| Method | Path                  | Body | Notes |
|--------|-----------------------|------|-------|
| GET    | `/api/nodes`          | —    | Lists paired secondaries: `[{ "id": string, "address": string }]`. The stored token is **never** returned. |
| POST   | `/api/nodes/pair`     | `{ "address": string, "code": string }` | Main calls the secondary's `/agent/pair`, stores the returned token + address, returns `{ "id": string, "address": string }`. 502 if unreachable, 400 if the code is rejected. |
| DELETE | `/api/nodes/:id`      | —    | Unpair / forget a secondary. |

**Proxying.** Anything under `/api/nodes/:id/<rest>` is forwarded to the
secondary's `/agent/<rest>` with the stored bearer token, so the same
dashboard / scripts / updates views work against a secondary just by changing
the path prefix (e.g. `/api/nodes/:id/resources`, `/api/nodes/:id/catalog`,
`/api/nodes/:id/jobs/:jid/stream`). The browser never talks to a secondary
directly — live job output is relayed through Main over its own WS. An
unreachable node returns **502** with `{ "error": "node unreachable" }` rather
than hanging (the M2 degraded-state pattern).

## Version & Update Check (Milestone 7)

Session-gated like the rest of `/api`. The running version is embedded at
release time via `-ldflags "-X main.version=$(git describe --tags --always)"`;
local builds report `"dev"`.

| Method | Path                | Notes |
|--------|---------------------|-------|
| GET    | `/api/version`      | `{ "version": string }` — the running build's version. |
| GET    | `/api/update-check` | `{ "current_version": string, "latest_version": string, "update_available": bool }`. Compares the embedded version against the latest GitHub release (`tag_name`), cached ~24h. On any GitHub error it returns the current version with `latest_version: ""` and `update_available: false` — an update check never breaks the dashboard. A `"dev"` (non-release) build never reports an update available. |

## Lab Notebook (Milestone 9)

Freeform timestamped notes, optionally pinned to a node/VM/CT. Session-gated
like the rest of `/api`. Persisted to a JSON flat file (`notes.json`, beside the
job store) — the same store pattern M3 uses, **not** SQLite (despite older
"SQLite" comments elsewhere in the tree).

A **note**: `{ "id": int, "content": string, "entity_type": "node"|"vm"|"lxc"|"", "entity_id": string, "color": "yellow"|"teal"|"pink"|"blue", "pinned": bool, "created_at": RFC3339, "updated_at": RFC3339 }`. `entity_type`/`entity_id` are both empty for a general note.

| Method | Path                | Body | Notes |
|--------|---------------------|------|-------|
| GET    | `/api/notes`        | —    | All notes, pinned first then newest. Optional query: `?entity_type=&entity_id=` (filter to one entity), `?q=` (case-insensitive `content` substring). |
| POST   | `/api/notes`        | `{ "content", "entity_type"?, "entity_id"?, "color"? }` | Creates a note (201). `content` required, ≤2000 chars. `entity_type` (if set) must be `node`/`vm`/`lxc` and requires `entity_id` (and vice-versa). `color` defaults `yellow`. 400 on validation failure. |
| PUT    | `/api/notes/:id`    | `{ "content"?, "color"?, "pinned"? }` | Partial update; bumps `updated_at`. Entity link is not re-editable in v1. 404 if missing. |
| DELETE | `/api/notes/:id`    | —    | Hard delete. `{ "ok": true }`, or 404 if missing. |
| GET    | `/api/notes/counts` | —    | `[{ "entity_type", "entity_id", "count" }]` for every linked entity with ≥1 note (general notes excluded) — drives the note badge on VM/CT tiles. |

