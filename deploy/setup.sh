#!/usr/bin/env bash
#
# First-time VPS setup for Shinchat Helper. Ubuntu 22.04/24.04 or Debian 12.
# Idempotent — safe to re-run after a code update.
#
#   sudo bash deploy/setup.sh
#
# Assumes the project is already at /opt/shinchat-helper (see the README).
# Does NOT touch .env: you write that yourself so no secret ever lands in a script.

set -euo pipefail

APP_DIR=/opt/shinchat-helper
APP_USER=shinchat
NODE_MAJOR=22
SERVICE=shinchat-helper

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo bash deploy/setup.sh" >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Expected the project at $APP_DIR but found no package.json there." >&2
  echo "Copy or clone the code to $APP_DIR first, then re-run." >&2
  exit 1
fi

echo "==> Installing system packages"
apt-get update -qq
# python3/make/g++ are needed to compile better-sqlite3's native module.
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg python3 make g++ sqlite3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  echo "==> Installing Node.js ${NODE_MAJOR}.x"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
echo "    node $(node -v)"

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  echo "==> Creating service user '$APP_USER'"
  # No login shell, no home directory to compromise.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

echo "==> Building"
cd "$APP_DIR"
npm ci
npm run build
# Drop the dev toolchain now that dist/ exists.
npm prune --omit=dev

echo "==> Setting ownership and permissions"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/data"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
if [[ -f "$APP_DIR/.env" ]]; then
  # Secrets are readable by the service user and nobody else.
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
else
  echo "    !! $APP_DIR/.env is missing. Copy .env.example to .env and fill it in," >&2
  echo "       then: sudo chown $APP_USER:$APP_USER .env && sudo chmod 600 .env" >&2
fi

echo "==> Installing the systemd unit"
install -m 0644 "$APP_DIR/deploy/${SERVICE}.service" "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

cat <<EOF

Setup complete. Remaining steps:

  1. Make sure $APP_DIR/.env is filled in with NODE_ENV=production.
  2. Publish the slash commands (once, and after any command change):
       sudo -u $APP_USER node $APP_DIR/dist/scripts/registerCommands.js
  3. Start the bot:
       sudo systemctl restart $SERVICE
  4. Watch it come up:
       sudo journalctl -u $SERVICE -f

EOF
