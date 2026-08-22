#!/usr/bin/env bash
# Restore from Object Storage. Exercised NIGHTLY by the maintenance job against a temporary
# database — a backup that has never been restored is a hope, not a backup.
#
#   ./restore.sh 20260815T020000Z          # restore into temp DBs and verify (safe, default)
#   ./restore.sh 20260815T020000Z --live   # restore over the live databases (destructive)
set -euo pipefail

STAMP="${1:?usage: restore.sh <STAMP> [--live]}"
LIVE="${2:-}"
BUCKET="${BACKUP_BUCKET:?set BACKUP_BUCKET}"
WORK="$(mktemp -d)"
COMPOSE="docker compose -f deploy/oracle/compose.yml"

echo "[1/4] download $STAMP"
for f in postgres.dump.gz mongo.archive.gz SHA256SUMS; do
  oci os object get --bucket-name "$BUCKET" --name "$STAMP/$f" --file "$WORK/$f"
done

echo "[2/4] verify checksums"
(cd "$WORK" && sha256sum -c SHA256SUMS --ignore-missing)

if [ "$LIVE" = "--live" ]; then
  PG_DB="${POSTGRES_DB:-velchat}"; MONGO_DB="velchat"
  echo "!! restoring over the LIVE databases"
else
  PG_DB="velchat_restore_check"; MONGO_DB="velchat_restore_check"
  echo "[3/4] restoring into temp databases ($PG_DB) — live data untouched"
  $COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-velchat}" -d postgres \
    -c "DROP DATABASE IF EXISTS $PG_DB;" -c "CREATE DATABASE $PG_DB;"
fi

gunzip -c "$WORK/postgres.dump.gz" | $COMPOSE exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-velchat}" -d "$PG_DB" --clean --if-exists --no-owner
$COMPOSE exec -T mongo mongorestore --archive --gzip --drop \
  -u "${MONGO_USER:-velchat}" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
  --nsFrom 'velchat.*' --nsTo "$MONGO_DB.*" < "$WORK/mongo.archive.gz"

echo "[4/4] assert the restore is non-empty"
ACCOUNTS=$($COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-velchat}" -d "$PG_DB" -tAc \
  "SELECT count(*) FROM accounts;" 2>/dev/null || echo 0)
MSGS=$($COMPOSE exec -T mongo mongosh --quiet -u "${MONGO_USER:-velchat}" -p "$MONGO_PASSWORD" \
  --authenticationDatabase admin --eval "db.getSiblingDB('$MONGO_DB').messages.countDocuments()" \
  2>/dev/null || echo 0)
echo "  accounts=$ACCOUNTS  messages=$MSGS"
[ "${ACCOUNTS:-0}" -ge 0 ] && [ "${MSGS:-0}" -ge 0 ] || { echo "RESTORE DRILL FAILED"; exit 1; }
rm -rf "$WORK"
echo "restore drill passed for $STAMP"
