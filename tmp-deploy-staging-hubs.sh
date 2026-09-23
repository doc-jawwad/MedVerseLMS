#!/bin/bash
# Staging-only: Past Papers / Other Services / PDF body-limit (aaadd7b).
# Does NOT touch /opt/medverse or production DB.
set -euo pipefail

COMMIT_SHORT=aaadd7b
COMMIT_FULL=aaadd7b95c362b1e8693a28d10f7c9f9aeae2483
TGZ=/tmp/medverse-${COMMIT_SHORT}.tgz
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REL="${STAMP}-${COMMIT_SHORT}-hubs-pdf"
DST="/opt/medverse-staging/releases/${REL}"
MIG=/tmp/20260923032635_other_services_past_papers_hubs.sql

PROD_BEFORE="$(readlink -f /opt/medverse/current)"
PROD_DB="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
STG_BEFORE="$(readlink -f /opt/medverse-staging/current)"
STG_DB_BEFORE="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"

echo "PROD_BEFORE=$PROD_BEFORE"
echo "PROD_DB=$PROD_DB"
echo "STG_BEFORE=$STG_BEFORE"
echo "STG_DB_BEFORE=$STG_DB_BEFORE"

test -f "$TGZ" || { echo "missing $TGZ"; exit 2; }
test -f "$MIG" || { echo "missing $MIG"; exit 2; }

BKDIR=/opt/medverse-staging/backups
sudo mkdir -p "$BKDIR"
sudo chown postgres:postgres "$BKDIR" || true
BK="$BKDIR/pre-hubs-${STAMP}.dump"
sudo -u postgres pg_dump -Fc -d medverse_staging -f "$BK"
echo "BACKUP=$BK size=$(stat -c%s "$BK")"

HAS="$(sudo -n -u postgres psql -d medverse_staging -Atc "select 1 from supabase_migrations.schema_migrations where version='20260923032635'")"
if [[ "$HAS" != "1" ]]; then
  sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -f "$MIG"
  sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -c \
    "insert into supabase_migrations.schema_migrations (version) values ('20260923032635') on conflict do nothing;"
  echo "MIG_APPLIED=20260923032635"
else
  echo "MIG_SKIP=already_applied"
fi

STG_DB_AFTER="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
echo "STG_DB_AFTER=$STG_DB_AFTER"

sudo mkdir -p "$DST"
sudo tar -xzf "$TGZ" -C "$DST"
echo "$COMMIT_FULL" | sudo tee "$DST/RELEASE_COMMIT" >/dev/null
sudo chown -R medverse:medverse "$DST"

sudo -u medverse bash -lc "
set -euo pipefail
cd '$DST'
set -a
source /etc/medverse-staging/nextjs.env
set +a
if echo \"\${SUPABASE_DIRECT_URL:-}\${NEXT_PUBLIC_SUPABASE_URL:-}\" | grep -q pxoxijlhcvbrostrquft; then
  echo 'REFUSE: production Auth URL in staging env'
  exit 3
fi
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
npm ci --include=dev
npm run build
"

if grep -Rqs 'pxoxijlhcvbrostrquft' "$DST/.next/server" "$DST/.next/static" 2>/dev/null; then
  echo "FAIL: production Auth ref baked into staging .next"
  exit 3
fi
if ! grep -Rqs 'staging.medversepk.com' "$DST/.next/server" "$DST/.next/static" 2>/dev/null; then
  echo "FAIL: staging origin not found in .next bundles"
  exit 3
fi

sudo ln -sfn "$DST" /opt/medverse-staging/current
sudo systemctl restart medverse-staging-next.service
sudo systemctl restart medverse-staging-postgrest.service || true

sleep 3
curl -fsS -o /dev/null -w "HEALTH=%{http_code}\n" -A 'Mozilla/5.0' https://staging.medversepk.com/api/health || true
systemctl is-active medverse-staging-next.service medverse-staging-postgrest.service

PROD_AFTER="$(readlink -f /opt/medverse/current)"
PROD_DB_AFTER="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
echo "PROD_AFTER=$PROD_AFTER"
echo "PROD_DB_AFTER=$PROD_DB_AFTER"
[[ "$PROD_BEFORE" == "$PROD_AFTER" ]] || { echo "PROD_PATH_CHANGED"; exit 4; }
[[ "$PROD_DB" == "$PROD_DB_AFTER" ]] || { echo "PROD_DB_CHANGED"; exit 5; }
echo "STAGING_APP=$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"
echo "STAGING_RELEASE=$DST"
echo "OK"
