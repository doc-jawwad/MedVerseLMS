#!/usr/bin/env bash
# Apply VPS-only SQL (roles + auth.uid helpers). Refuses Cloud hosts.
# Then run: supabase migration up --db-url <localhost url>
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bootstrap-vps-db.sh [--dry-run]

Requires PGHOST=127.0.0.1 (or localhost), PGDATABASE, PGUSER.
Set the authenticator password separately in psql (do not pass it on the shell command line).
EOF
}

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && { usage; exit 0; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SQL_DIR="$ROOT/deploy/postgres"

if [[ "${PGHOST:-}" == *supabase.co* || "${PGHOST:-}" == *pooler.supabase.com* ]]; then
  echo "refusing Cloud hosted Postgres" >&2
  exit 2
fi

if [[ "${PGHOST:-}" != "127.0.0.1" && "${PGHOST:-}" != "localhost" && "${PGHOST:-}" != "::1" ]]; then
  echo "PGHOST must be loopback" >&2
  exit 2
fi

echo "bootstrap plan: host=${PGHOST} db=${PGDATABASE:-} dry_run=${DRY_RUN}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "would apply ${SQL_DIR}/bootstrap_roles.sql and auth_helpers.sql"
  exit 0
fi

psql -v ON_ERROR_STOP=1 -f "$SQL_DIR/bootstrap_roles.sql"
psql -v ON_ERROR_STOP=1 -f "$SQL_DIR/auth_helpers.sql"

echo "bootstrap complete — next: ALTER ROLE authenticator PASSWORD (psql, not logged); then supabase migration up"
