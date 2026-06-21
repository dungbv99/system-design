#!/usr/bin/env bash
# Postgres first-init hook (runs ONCE, only when the data volume is empty).
#
#   • If a database dump is present  → restore schema + data from it.
#   • Otherwise                      → apply the schema-only init.sql.
#
# Either way the crawler comes up with a valid schema. Mounted into
# /docker-entrypoint-initdb.d/ so the official entrypoint runs it automatically
# on first start; on subsequent starts (non-empty volume) it is skipped, so an
# existing DB is never overwritten.
set -e

DUMP=/seed/stock_dump.sql.gz
SCHEMA=/seed/init.sql
PSQL=(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")

if [ -f "$DUMP" ]; then
    echo "[init] data dump found — restoring from $DUMP ..."
    gunzip -c "$DUMP" | "${PSQL[@]}"
    echo "[init] restore complete."
elif [ -f "$SCHEMA" ]; then
    echo "[init] no dump — applying schema $SCHEMA ..."
    "${PSQL[@]}" -f "$SCHEMA"
    echo "[init] schema applied (empty database)."
else
    echo "[init] WARNING: neither $DUMP nor $SCHEMA found; starting empty."
fi
