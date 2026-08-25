#!/usr/bin/env bash
#
# Back up the SQLite database. Everything every server taught the bot lives in that one
# file, so this is the only thing on the VPS that is genuinely irreplaceable.
#
# Run it from cron as the service user:
#   sudo crontab -u shinchat -e
#   17 4 * * *  /opt/shinchat-helper/deploy/backup.sh
#
# Uses sqlite3's online .backup so a snapshot is never a half-written page, which a
# plain `cp` of a live database can be.

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/shinchat-helper}
DB=${DATABASE_PATH:-$APP_DIR/data/shinchat.sqlite}
DEST=${BACKUP_DIR:-$APP_DIR/data/backups}
KEEP_DAYS=${KEEP_DAYS:-30}

if [[ ! -f "$DB" ]]; then
  echo "No database at $DB — nothing to back up." >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP=$(date +%F-%H%M)
OUT="$DEST/shinchat-$STAMP.sqlite"

sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"
chmod 600 "$OUT.gz"

# Prune old snapshots so the disk cannot fill up silently.
find "$DEST" -name 'shinchat-*.sqlite.gz' -type f -mtime "+$KEEP_DAYS" -delete

echo "backed up to $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
