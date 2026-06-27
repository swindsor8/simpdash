# SuperDash

A one-click update/install dashboard for Proxmox VE hosts, with cluster-wide
resource monitoring (host + VM + LXC) and optional multi-node management via
a lightweight agent pairing model.

## Status

This is scaffolding from Milestone 1 (see project history) — structure,
contracts, install script, and a fully working **frontend with mock data**
are done. The **Go backend is not yet implemented** (this dev sandbox has no
Go toolchain — see note below), so the next real step is writing
`cmd/server/main.go` and the `internal/*` packages against `API_CONTRACT.md`.

## What's actually built right now

- `frontend/` — real React app (Vite + Tailwind + Framer Motion), builds
  clean with `npm run build`. Currently renders from `src/lib/mockData.js`.
  Swap the `useSimulatedLiveResources` hook in `App.jsx` for a real
  WebSocket connection to `/api/resources/stream` once the backend exists.
- `scripts/install.sh` — the real `curl | bash` installer. Asks main vs
  secondary, writes systemd unit + initial config. The binary download step
  has a placeholder URL (`yourtool.dev`) — point it at your own release
  pipeline, or for local dev, comment out the download and `go build` +
  copy the binary into place manually (instructions are in the script).
- `backend/internal/config/config.go` — the config schema as Go structs +
  doc comments, with `Load`/`Save` stubbed with `panic("not implemented")`.
  This compiles conceptually but needs a real Go toolchain to verify —
  implement with `gopkg.in/yaml.v3`.
- `API_CONTRACT.md` — the full route/payload contract both sides should
  conform to. Keep this updated as the source of truth; it's what let the
  frontend get built before the backend existed.

## Why the backend is stubs, not code

This build environment doesn't have network access to `go.dev` (sandboxed
to a small package-registry allowlist), so I couldn't install a Go
toolchain to write and verify real backend code here. Rather than write Go
I can't compile or test — which risks silently wrong code — I documented
the schema/contract precisely instead. Pull this repo down locally (where
you have Go installed) and the next session can write real, buildable Go
against `API_CONTRACT.md` and `config.go`'s doc comments.

## Next steps (in order)

1. **`cmd/server/main.go`** — parse `--config` flag, load config, decide
   main vs secondary mode, start HTTP server on `listen_addr`.
2. **`internal/config`** — implement `Load`/`Save` for real (yaml.v3 +
   atomic file writes).
3. **`internal/api`** — auth routes (`/api/setup/*`, `/api/auth/*`) per
   the contract. Get the onboarding flow (set password → logged in) working
   end-to-end with the existing frontend before touching Proxmox.
4. **`internal/proxmox`** — token auto-provisioning (`pveum` calls via
   `os/exec` on first run) + `/cluster/resources` client. Wire to
   `/api/resources` and `/api/resources/stream` (WS).
5. **`internal/executor`** — subprocess runner with output streaming +
   single-job lock. Wire to `/api/updates/*` and `/api/jobs/*`.
6. **`catalog/manifest.yaml`** + `/api/catalog/*` routes — Milestone 4.
7. **`internal/agent`** — secondary pairing handshake — Milestone 5.

## Local dev loop (once backend exists)

```bash
# terminal 1: backend
cd backend && go run ./cmd/server --config ./dev-config.yaml

# terminal 2: frontend (proxies /api to :7575, see vite.config.js)
cd frontend && npm install && npm run dev
```

## Production build

```bash
cd frontend && npm run build        # outputs frontend/dist
cd ../backend && go build -o homelab-dash ./cmd/server   # embeds dist/ via web/embed.go (not yet written)
```
