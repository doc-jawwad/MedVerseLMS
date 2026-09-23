#!/bin/bash
# Finish staging cutover for already-built aaadd7b release (migration already applied).
set -euo pipefail
DST="$(ls -dt /opt/medverse-staging/releases/*aaadd7b-hubs-pdf 2>/dev/null | head -1)"
test -n "$DST" && test -d "$DST/.next"
PROD_BEFORE="$(readlink -f /opt/medverse/current)"
PROD_DB="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"

if grep -Rqs 'pxoxijlhcvbrostrquft' "$DST/.next/server" "$DST/.next/static" 2>/dev/null; then
  echo "FAIL: production Auth ref in bundles"; exit 3
fi
if ! grep -Rqs 'staging.medversepk.com' "$DST/.next/server" "$DST/.next/static" 2>/dev/null; then
  echo "FAIL: staging origin missing in bundles"; exit 3
fi

sudo ln -sfn "$DST" /opt/medverse-staging/current
sudo systemctl restart medverse-staging-next.service
sudo systemctl restart medverse-staging-postgrest.service || true
sleep 3
curl -fsS -o /dev/null -w "HEALTH=%{http_code}\n" -A 'Mozilla/5.0' https://staging.medversepk.com/api/health
systemctl is-active medverse-staging-next.service medverse-staging-postgrest.service
echo "STG_DB=$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
echo "STG_APP=$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"
echo "STG_CURRENT=$(readlink -f /opt/medverse-staging/current)"
PROD_AFTER="$(readlink -f /opt/medverse/current)"
PROD_DB_AFTER="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
[[ "$PROD_BEFORE" == "$PROD_AFTER" ]] || exit 4
[[ "$PROD_DB" == "$PROD_DB_AFTER" ]] || exit 5
echo "PROD_UNTOUCHED=yes"
echo "OK"
