#!/usr/bin/env bash
# Apply MedVerse migrations to medverse_staging only.
# Strips pg_cron schedule/unschedule so a shared cron.database_name=medverse
# catalog cannot be modified. Refuses the production database name.
set -euo pipefail

TARGET_DB="${PGDATABASE:-medverse_staging}"
if [[ "$TARGET_DB" != "medverse_staging" ]]; then
  echo "refusing database '$TARGET_DB' (only medverse_staging is allowed)" >&2
  exit 2
fi
if [[ "${PGHOST:-127.0.0.1}" != "127.0.0.1" && "${PGHOST:-}" != "localhost" && "${PGHOST:-}" != "::1" ]]; then
  echo "PGHOST must be loopback" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="${MEDVERSE_MIGRATIONS_DIR:-$ROOT/supabase/migrations}"
BOOT_DIR="$ROOT/deploy/postgres"
CRON_BEFORE="$(mktemp)"
CRON_AFTER="$(mktemp)"
trap 'rm -f "$CRON_BEFORE" "$CRON_AFTER"' EXIT

psql_prod() {
  sudo -n -u postgres psql -d medverse -v ON_ERROR_STOP=1 "$@"
}
psql_stg() {
  sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 "$@"
}

echo "snapshot production cron.job"
psql_prod -Atqc "select jobid||'|'||jobname||'|'||schedule||'|'||command||'|'||database||'|'||username||'|'||active from cron.job order by jobid" >"$CRON_BEFORE"

python3 - "$MIG_DIR" /tmp/medverse-staging-migrations-stripped <<'PY'
import pathlib, re, sys
src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
dst.chmod(0o755)
# Only the nested pg_cron install/schedule blocks, not every DO $$ in the file.
cron_do = re.compile(
    r"do\s+\$\$\s*begin\s*begin\s*create\s+extension\s+if\s+not\s+exists\s+pg_cron;.*?end\s+\$\$\s*;",
    re.IGNORECASE | re.DOTALL,
)
ext = re.compile(
    r"create\s+extension\s+if\s+not\s+exists\s+pg_cron\s*;",
    re.IGNORECASE,
)
for path in sorted(src.glob("*.sql")):
    text = path.read_text(encoding="utf-8")
    text = cron_do.sub(
        "-- stripped: pg_cron job (shared catalog; staging must not schedule)\n",
        text,
    )
    text = ext.sub("-- stripped: create extension pg_cron\n", text)
    if re.search(r"cron\.(schedule|unschedule)\s*\(", text, re.I):
        raise SystemExit(f"cron schedule leftover in {path.name}")
    (dst / path.name).write_text(text, encoding="utf-8")
    (dst / path.name).chmod(0o644)
print("stripped migrations ->", dst)
PY

psql_stg -c "do \$\$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end \$\$;"
install -m 0644 "$BOOT_DIR/auth_helpers.sql" /tmp/auth_helpers_staging.sql
psql_stg -f /tmp/auth_helpers_staging.sql
rm -f /tmp/auth_helpers_staging.sql
install -m 0644 "$BOOT_DIR/auth_users_stub.sql" /tmp/auth_users_stub.sql
psql_stg -f /tmp/auth_users_stub.sql
rm -f /tmp/auth_users_stub.sql
psql_stg -c "create schema if not exists supabase_migrations;"
psql_stg -c "create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, applied_at timestamptz not null default now());"

shopt -s nullglob
for f in /tmp/medverse-staging-migrations-stripped/*.sql; do
  base="$(basename "$f")"
  ver="${base%%_*}"
  applied="$(psql_stg -Atqc "select 1 from supabase_migrations.schema_migrations where version = '$ver'")"
  if [[ "$applied" == "1" ]]; then
    echo "skip $base"
    continue
  fi
  echo "apply $base"
  install -m 0644 "$f" "/tmp/apply-one.sql"
  psql_stg -f /tmp/apply-one.sql
  rm -f /tmp/apply-one.sql
  psql_stg -c "insert into supabase_migrations.schema_migrations (version, name) values ('$ver', '$base');"
done

echo "verify production cron.job unchanged"
psql_prod -Atqc "select jobid||'|'||jobname||'|'||schedule||'|'||command||'|'||database||'|'||username||'|'||active from cron.job order by jobid" >"$CRON_AFTER"
if ! cmp -s "$CRON_BEFORE" "$CRON_AFTER"; then
  echo "ABORT: production cron.job changed during staging migrate" >&2
  echo "before:" >&2
  cat "$CRON_BEFORE" >&2
  echo "after:" >&2
  cat "$CRON_AFTER" >&2
  exit 3
fi
echo "cron.job unchanged"
