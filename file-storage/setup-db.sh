#!/usr/bin/env bash
# Creates the 'filestorage' database in the local PostgreSQL instance.
# Run this once before starting the application.

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"

export PGPASSWORD

echo "→ Connecting to PostgreSQL at $PGHOST:$PGPORT as $PGUSER"

if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
       -tc "SELECT 1 FROM pg_database WHERE datname='filestorage'" | grep -q 1; then
    echo "✓ Database 'filestorage' already exists."
else
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
         -c "CREATE DATABASE filestorage;"
    echo "✓ Database 'filestorage' created."
fi

echo ""
echo "✅ Ready. Run the application with:"
echo "   mvn spring-boot:run"
