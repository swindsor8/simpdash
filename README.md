# SuperDash

A lightweight, single-binary homelab dashboard for **Proxmox VE** — combining real-time cluster resource monitoring, one-click host & batch LXC updates, interactive community-script installs, Proxmox Backup Server (PBS) visibility, and multi-node management.

Built with **Go** + **React (Vite + Tailwind)**, compiled into a single static binary with zero runtime dependencies.

## Features

- **Live Cluster Monitoring** — Real-time WebSocket stream of CPU, RAM, disk, storage pools, interactive 1h/24h/7d RRD charts, guest IPs, tags, and power controls (start, stop, shutdown, reboot, Wake-on-LAN) with Proxmox noVNC/xterm console deep-links.
- **Hardware Health** — Live thermal & fan sensors (`/sys/class/hwmon`), SMART drive health (NVMe wear, temps, power-on hours, sector/media errors), and ZFS pool status with vdev error trees — on both the local host and paired secondary nodes.
- **One-Click Host & Batch LXC Updates** — Scan and apply host `apt` upgrades (with `dist-upgrade` option, version diffs, and reboot-required detection), update individual LXCs, or run a sequential **Update All LXCs** batch queue (`apt-get` / `apk` / `dnf`) with persisted excludes, live progress, and job cancellation on local or paired nodes.
- **Interactive Script Catalog** — Browse, sync, and run Proxmox community scripts inside a real in-browser PTY terminal (`xterm.js`) with full bidirectional whiptail menu support (including on paired secondary nodes).
- **Multi-Node Pairing** — Install SuperDash in `secondary` agent mode on additional Proxmox hosts and pair them with a single-use code to manage multiple nodes from one UI.
- **LXC / Standalone API Support** — Auto-provisions a scoped Proxmox API token via `pveum` when installed on a PVE host, or prompts for a Proxmox API URL & token during onboarding and Settings when running inside an LXC container or standalone host.
- **Backups & PBS Integration** — Track `vzdump` backup coverage per guest alongside Proxmox Backup Server datastore usage and verification status (with TLS fingerprint pinning and live connection testing).
- **Network & Speedtest** — Inspect node interfaces, live throughput stats, connectivity checks, and historical speed tests.
- **Task Scheduler** — Schedule one-time or recurring updates, Proxmox `vzdump` backups, snapshots, power actions, and speedtests with cron preview and FIFO queueing.
- **Guest Introspection & Service Links** — View running systemd services and Docker containers inside local LXCs, attach clickable web-UI links with auto-fetched icons, and monitor HTTP health dots.
- **Lab Notebook & Activity Log** — Keep entity-linked markdown notes (with interactive checklists) on nodes/VMs/LXCs and review or cancel SuperDash jobs alongside Proxmox cluster tasks.
- **Alerts, 2FA, Backup/Restore & Themes** — Push notifications via **ntfy**, **Gotify**, **Discord**, or generic webhooks (job failures, offline nodes, unreachable services, storage thresholds, stale backups, PBS verify failures, and apt digests); TOTP 2FA with offline QR code enrollment and recovery codes; password management; non-secret JSON config export/import; multiple built-in themes; and PWA support.
- **One-Click Self-Update** — Checks GitHub Releases automatically, verifies SHA-256 checksums, atomically swaps the binary, restarts via systemd, and reloads the UI.

## Quick Install (Proxmox VE Host)

Run as `root` on your Proxmox VE host:

```bash
curl -fsSL https://raw.githubusercontent.com/swindsor8/simpdash/main/scripts/install.sh | bash
```

This downloads the latest verified release binary (`linux/amd64` or `linux/arm64`), creates `/etc/homelab-dash/config.yaml`, and enables the `simpdash` systemd service on port `7575`.

Open `http://<proxmox-ip>:7575` to set your admin password. When installed directly on a Proxmox host, SuperDash automatically provisions a scoped Proxmox API token on first run. When installed inside an LXC or standalone Linux host, onboarding prompts for your Proxmox VE URL and API token (also configurable anytime under **Settings → Proxmox VE connection**).

### Installing a Secondary Node (Agent Mode)

```bash
SIMPDASH_MODE=secondary curl -fsSL https://raw.githubusercontent.com/swindsor8/simpdash/main/scripts/install.sh | bash
```

Check `journalctl -u simpdash -n 20` on the secondary to grab its 15-minute pairing code, then add it from **Nodes → Add node** on your main SuperDash instance.

### Updating

Once installed from a GitHub Release (`v0.1.0+`), SuperDash notifies you in the UI when a newer release is available and lets you update in one click from the top banner or **Settings → SuperDash updates**.

You can also re-run the installer one-liner at any time — it updates in place and preserves your config, password, and database.

## Progressive Web App (PWA)

The frontend ships a web app manifest, app icons, and a service worker (`vite-plugin-pwa`) so SuperDash can be added to a phone's home screen with instant shell loads. The service worker precaches only static shell assets and never caches `/api/*` or WebSocket streams.

> **Note:** Browsers require HTTPS (or `localhost`) to register service workers and enable full PWA installability. Put SuperDash behind a reverse proxy with TLS (e.g., Caddy, Nginx, Traefik) for the full PWA experience.

## Security Model

- Single-admin bcrypt password + optional TOTP 2FA (`HttpOnly`, `SameSite=Strict` HMAC session cookie, auto-`Secure` behind TLS/reverse proxy).
- Login rate limiting per client IP.
- Secrets (Proxmox token, PBS secret, notification tokens) are stored in `/etc/homelab-dash/config.yaml` (`0600`, `root:root`) and are write-only in the Settings API.
- Single-job executor lock prevents concurrent privileged operations from racing.
- Self-updates verify SHA-256 digests against release `checksums.txt` and smoke-test `--version` before atomically replacing the binary.

## Building from Source

Requires **Node.js 22+** and **Go 1.22+**:

```bash
# Build frontend (outputs into backend/web/dist for go:embed)
cd frontend && npm ci && npm run build

# Build single static Go binary
cd ../backend && CGO_ENABLED=0 go build -ldflags "-s -w" -o simpdash ./cmd/server
```

### Local Development

```bash
# Terminal 1 — backend
cd backend && go run ./cmd/server --config ./dev-config.yaml

# Terminal 2 — frontend dev server (proxies /api to :7575)
cd frontend && npm install && npm run dev
```

See [API_CONTRACT.md](API_CONTRACT.md) for the complete HTTP and WebSocket API specification.

## License

[MIT](LICENSE)
