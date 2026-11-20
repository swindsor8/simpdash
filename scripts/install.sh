#!/usr/bin/env bash
# SimpDash installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/swindsor8/simpdash/main/scripts/install.sh | bash
#
# Installs the latest prebuilt release binary from GitHub Releases (with SHA-256
# verification when checksums.txt is present) and starts a systemd service.
# Falls back to building from source if no release exists yet or if
# SIMPDASH_FROM_SOURCE=1 is set. Re-run to update; config is preserved.
set -euo pipefail

REPO="swindsor8/simpdash"
BUILD_DIR="/tmp/simpdash-build"
BIN="/usr/local/bin/simpdash"
CONFIG_DIR="/etc/homelab-dash"
CONFIG="$CONFIG_DIR/config.yaml"
UNIT="/etc/systemd/system/simpdash.service"
MODE="${SIMPDASH_MODE:-main}"
FROM_SOURCE="${SIMPDASH_FROM_SOURCE:-0}"
GO_VERSION="1.22.4"

[ "$(id -u)" -eq 0 ] || { echo "Please run as root." >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

# ── speedtest-cli (powers the Network tab speed test) ─────────────────────────
if ! command -v speedtest-cli &>/dev/null; then
  echo "Installing speedtest-cli ..."
  apt-get install -y speedtest-cli || echo "speedtest-cli install failed — speed test will be unavailable." >&2
fi

# ── Install binary (prebuilt release preferred, source build fallback) ────────
TMP_BIN="${BIN}.new.$$"
trap 'rm -f "$TMP_BIN"' EXIT

install_from_release() {
  local tag asset base_url checksums_tmp expected
  tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$tag" ] || return 1

  asset="simpdash-linux-${ARCH}"
  base_url="https://github.com/$REPO/releases/download/$tag"
  echo "Downloading SimpDash $tag ($asset) ..."
  curl -fsSL -o "$TMP_BIN" "$base_url/$asset" || return 1

  checksums_tmp="$(mktemp)"
  if curl -fsSL -o "$checksums_tmp" "$base_url/checksums.txt" 2>/dev/null; then
    expected="$(awk -v f="$asset" '{sub(/^\*/, "", $2); if ($2 == f) {print $1; exit}}' "$checksums_tmp")"
    rm -f "$checksums_tmp"
    if [ -n "$expected" ]; then
      echo "$expected  $TMP_BIN" | sha256sum -c - --status || {
        echo "Checksum verification failed for $asset!" >&2
        return 1
      }
      echo "Checksum verified."
    fi
  else
    rm -f "$checksums_tmp"
  fi

  chmod 0755 "$TMP_BIN"
  mv -f "$TMP_BIN" "$BIN"
  return 0
}

install_from_source() {
  # Go
  if ! command -v /usr/local/go/bin/go &>/dev/null; then
    echo "Installing Go $GO_VERSION ..."
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
      | tar -C /usr/local -xz
  fi
  export PATH=$PATH:/usr/local/go/bin

  # Node / npm
  if ! command -v node &>/dev/null; then
    echo "Installing Node.js 22 ..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  # Repo (tarball — no git required)
  echo "Downloading $REPO source ..."
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" \
    | tar -xz -C "$BUILD_DIR" --strip-components=1

  # Frontend
  echo "Building frontend ..."
  cd "$BUILD_DIR/frontend"
  npm install --silent
  npm run build --silent

  # Backend
  echo "Building backend ..."
  cd "$BUILD_DIR/backend"
  CGO_ENABLED=0 go build -ldflags "-s -w" -o "$TMP_BIN" ./cmd/server
  chmod 0755 "$TMP_BIN"
  mv -f "$TMP_BIN" "$BIN"
}

UPDATING=0
if [ -f "$BIN" ] || [ -f "$UNIT" ] || [ -f "$CONFIG" ]; then
  UPDATING=1
fi

if [ "$FROM_SOURCE" = "1" ]; then
  install_from_source
elif ! install_from_release; then
  echo "No prebuilt release found; falling back to building from source ..."
  install_from_source
fi

# ── Config ─────────────────────────────────────────────────────────────────────
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
Environment=PATH=/usr/sbin:/usr/bin:/sbin:/bin

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
