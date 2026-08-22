#!/usr/bin/env bash
# Nightly backup → Oracle Object Storage, which is a DIFFERENT service from the VM. That is the
# whole point: if the instance is reclaimed or lost, the backups are not on it.
#
# Runs as the `maintenance` step. Every task here is worth doing on its own merits; keeping the
# instance non-idle is a side effect, never the justification (see §4.1 of the design spec).
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="${BACKUP_DIR:-/var/backups/velchat}/$STAMP"
BUCKET="${BACKUP_BUCKET:?set BACKUP_BUCKET}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-7}"
mkdir -p "$DIR"

echo "[1/5] postgres dump"
docker compose -f deploy/oracle/compose.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-velchat}" -Fc "${POSTGRES_DB:-velchat}" > "$DIR/postgres.dump"

echo "[2/5] mongo dump"
docker compose -f deploy/oracle/compose.yml exec -T mongo \
  mongodump --archive --gzip -u "${MONGO_USER:-velchat}" -p "$MONGO_PASSWORD" \
  --authenticationDatabase admin > "$DIR/mongo.archive.gz"

# Valkey is deliberately absent: after the DEF-01 fix it holds no durable state. `seq:*` re-seeds
# from MAX(seq) in Mongo, the connection registry rebuilds as clients reconnect, and typing/presence
# are ephemeral by definition. Nothing to back up.

echo "[3/5] compress + checksum"
gzip -9 -f "$DIR/postgres.dump"
sha256sum "$DIR"/* > "$DIR/SHA256SUMS"

echo "[4/5] upload"
for f in "$DIR"/*; do
  oci os object put --bucket-name "$BUCKET" --name "$STAMP/$(basename "$f")" --file "$f" --force
done

echo "[5/5] database maintenance + prune"
docker compose -f deploy/oracle/compose.yml exec -T postgres \
  psql -U "${POSTGRES_USER:-velchat}" -d "${POSTGRES_DB:-velchat}" -c 'VACUUM ANALYZE;'
find "${BACKUP_DIR:-/var/backups/velchat}" -maxdepth 1 -type d -mtime "+$RETAIN_DAYS" -exec rm -rf {} +
docker image prune -f >/dev/null

echo "backup $STAMP complete"
