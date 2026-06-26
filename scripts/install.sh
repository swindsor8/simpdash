#!/usr/bin/env bash
# SimpDash installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/veidrdev/simpdash/main/scripts/install.sh | bash
#
# Installs Go + Node if missing, clones the repo, builds the frontend and
# backend from source, installs the binary, and starts a systemd service.
# Re-run to update: pulls latest, rebuilds, restarts. Config is preserved.
set -euo pipefail

REPO="swindsor8/simpdash"
REPO_URL="https://github.com/$REPO"
BUILD_DIR="/tmp/simpdash-build"
BIN="/usr/local/bin/simpdash"
CONFIG_DIR="/etc/homelab-dash"
CONFIG="$CONFIG_DIR/config.yaml"
UNIT="/etc/systemd/system/simpdash.service"
MODE="${SIMPDASH_MODE:-main}"
GO_VERSION="1.22.4"

[ "$(id -u)" -eq 0 ] || { echo "Please run as root." >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

# ── Go ─────────────────────────────────────────────────────────────────────────
if ! command -v /usr/local/go/bin/go &>/dev/null; then
  echo "Installing Go $GO_VERSION ..."
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
    | tar -C /usr/local -xz
fi
export PATH=$PATH:/usr/local/go/bin

# ── Node / npm ─────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v git &>/dev/null; then
  echo "Installing git ..."
  apt-get install -y git
fi

# ── Repo ───────────────────────────────────────────────────────────────────────
if [ -d "$BUILD_DIR/.git" ]; then
  echo "Updating repo ..."
  git -C "$BUILD_DIR" pull --ff-only
else
  echo "Cloning $REPO ..."
  rm -rf "$BUILD_DIR"
  git clone --depth 1 "$REPO_URL" "$BUILD_DIR"
fi

# ── Frontend ───────────────────────────────────────────────────────────────────
echo "Building frontend ..."
cd "$BUILD_DIR/frontend"
npm install --silent
npm run build --silent

# ── Backend ────────────────────────────────────────────────────────────────────
echo "Building backend ..."
cd "$BUILD_DIR/backend"
CGO_ENABLED=0 go build -o "$BIN" ./cmd/server

# ── Config ─────────────────────────────────────────────────────────────────────
UPDATING=0
if [ -f "$BIN.old" ] || [ -f "$UNIT" ] || [ -f "$CONFIG" ]; then
  UPDATING=1
fi

mkdir -p "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR"

if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
mode: $MODE
listen_addr: ":7575"
db_path: "$CONFIG_DIR/simpdash.db"
EOF
  chmod 0600 "$CONFIG"
fi

# ponytail: minimal sanity check, not full schema validation
if [ -f "$CONFIG" ] && ! grep -q '^mode:' "$CONFIG"; then
  echo "Config $CONFIG exists but looks malformed (no 'mode:' key)." >&2
  echo "Refusing to overwrite it. Fix or remove it, then re-run." >&2
  exit 1
fi

# ── Systemd ────────────────────────────────────────────────────────────────────
cat > "$UNIT" <<EOF
[Unit]
Description=SimpDash
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$BIN --config $CONFIG
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --quiet simpdash
systemctl restart simpdash

if [ "$UPDATING" -eq 1 ]; then
  echo "SimpDash updated and restarted."
else
  echo ""
  echo "SimpDash installed. Open http://$(hostname -I | awk '{print $1}'):7575 to set your password."
fi
