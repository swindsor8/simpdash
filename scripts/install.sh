#!/usr/bin/env bash
# SimpDash installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/swindsor8/simpdash/main/scripts/install.sh | bash
#
# Fresh install: drops the binary + a systemd unit, seeds a minimal config, and
# starts the service. Then open http://<this-host>:7575 to set your admin
# password — onboarding happens in the web UI, not here.
#
# Re-run to update: stops the service, swaps in the latest release binary, and
# restarts. Existing config/token are left untouched, so onboarding never
# repeats. A config that exists but looks malformed aborts the run rather than
# getting silently overwritten.
#
# Secondary node: run with SIMPDASH_MODE=secondary (the agent prints its pairing
# code to `systemctl status simpdash` on first boot).
set -euo pipefail

REPO="swindsor8/simpdash"
BIN="/usr/local/bin/simpdash"
CONFIG_DIR="/etc/homelab-dash"
CONFIG="$CONFIG_DIR/config.yaml"
UNIT="/etc/systemd/system/simpdash.service"
MODE="${SIMPDASH_MODE:-main}"

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (e.g. with sudo)." >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64)   ARCH=amd64 ;;
  aarch64|arm64)  ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
URL="https://github.com/$REPO/releases/latest/download/simpdash-linux-$ARCH"

UPDATING=0
if [ -f "$BIN" ] || [ -f "$UNIT" ] || [ -f "$CONFIG" ]; then
  UPDATING=1
  echo "Existing SimpDash install detected — updating in place."
  # A present-but-broken config means a half-finished or corrupted install.
  # Fail loudly rather than start a service that can't read its own config, or
  # clobber config the admin may still want to recover.
  # ponytail: the 'mode:' key is a minimal sanity check, not a full schema validation.
  if [ -f "$CONFIG" ] && ! grep -q '^mode:' "$CONFIG"; then
    echo "Config $CONFIG exists but looks malformed (no 'mode:' key)." >&2
    echo "Refusing to overwrite it. Fix or remove it, then re-run." >&2
    exit 1
  fi
fi

echo "Downloading simpdash-linux-$ARCH ..."
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP"

if [ "$UPDATING" -eq 1 ] && systemctl is-active --quiet simpdash; then
  echo "Stopping simpdash ..."
  systemctl stop simpdash
fi

install -m 0755 "$TMP" "$BIN"

mkdir -p "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR"

# Fresh install only: seed a minimal config. The binary generates its session
# secret on first boot; the UI handles password onboarding.
if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<EOF
mode: $MODE
listen_addr: ":7575"
db_path: "$CONFIG_DIR/simpdash.db"
EOF
  chmod 0600 "$CONFIG"
fi

# (Re)write the unit every run so unit fixes ship with updates.
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
  echo "SimpDash installed. Open http://<this-host>:7575 to set your admin password."
fi
