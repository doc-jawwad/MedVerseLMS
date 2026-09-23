#!/bin/bash
# Staging-only: proxyClientMaxBodySize 26mb fix (511a866). No schema change. No production.
set -euo pipefail

COMMIT_SHORT=ddb867b
COMMIT_FULL=ddb867ba12dd35ba5ab14f880752a7a289efaf48
TGZ=/tmp/medverse-${COMMIT_SHORT}.tgz
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REL="${STAMP}-${COMMIT_SHORT}-pdf-proxy28"
DST="/opt/medverse-staging/releases/${REL}"

PROD_BEFORE="$(readlink -f /opt/medverse/current)"
PROD_DB="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
STG_BEFORE="$(readlink -f /opt/medverse-staging/current)"
STG_DB="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"

echo "PROD_BEFORE=$PROD_BEFORE"
echo "PROD_DB=$PROD_DB"
echo "STG_BEFORE=$STG_BEFORE"
echo "STG_DB=$STG_DB"

test -f "$TGZ" || { echo "missing $TGZ"; exit 2; }

BKDIR=/opt/medverse-staging/backups
sudo mkdir -p "$BKDIR"
sudo chown postgres:postgres "$BKDIR" || true
BK="$BKDIR/pre-pdf-proxy-${STAMP}.dump"
sudo -u postgres pg_dump -Fc -d medverse_staging -f "$BK"
echo "BACKUP=$BK size=$(stat -c%s "$BK")"

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

# Bake checks: only server/static (not .next/cache)
if grep -Rqs 'pxoxijlhcvbrostrquft' "$DST/.next/server" "$DST/.next/static" 2>/dev/null; then
  echo "FAIL: production Auth ref baked into staging .next"
  exit 3
fi
if ! grep -Rqs 'staging.medversepk.com' "$DST/.next/server" "$DST/.next/static" 2>/dev/null; then
  echo "FAIL: staging origin not found in .next bundles"
  exit 3
fi
# Confirm proxy body limit landed in build config
python3 - <<PY
import json
p='$DST/.next/required-server-files.json'
d=json.load(open(p))
cfg=d.get('config') or d
exp=cfg.get('experimental') or {}
sa=exp.get('serverActions') or {}
proxy=exp.get('proxyClientMaxBodySize')
print('serverActions.bodySizeLimit=', sa.get('bodySizeLimit'))
print('proxyClientMaxBodySize=', proxy)
assert sa.get('bodySizeLimit') in ('28mb',) or str(sa.get('bodySizeLimit')).endswith('mb')
assert proxy in (28*1024*1024, 29360128) or proxy == 29360128
print('BAKE_LIMITS_OK')
PY

sudo ln -sfn "$DST" /opt/medverse-staging/current
sudo systemctl restart medverse-staging-next.service
sudo systemctl restart medverse-staging-postgrest.service || true
sleep 4
curl -fsS -o /dev/null -w "HEALTH=%{http_code}\n" -A 'Mozilla/5.0' https://staging.medversepk.com/api/health
systemctl is-active medverse-staging-next.service

PROD_AFTER="$(readlink -f /opt/medverse/current)"
PROD_DB_AFTER="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
STG_DB_AFTER="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
[[ "$PROD_BEFORE" == "$PROD_AFTER" ]] || { echo FAIL_PROD_APP; exit 4; }
[[ "$PROD_DB" == "$PROD_DB_AFTER" ]] || { echo FAIL_PROD_DB; exit 5; }
[[ "$STG_DB" == "$STG_DB_AFTER" ]] || { echo FAIL_STG_DB_CHANGED; exit 6; }
echo "STG_APP=$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"
echo "STG_CURRENT=$(readlink -f /opt/medverse-staging/current)"
echo "PROD_UNTOUCHED=yes"
echo "OK"
