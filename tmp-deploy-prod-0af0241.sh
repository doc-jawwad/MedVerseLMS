#!/bin/bash
# Production app cutover: EXACT tested app 0af0241.
# Does NOT touch staging. Migrations already applied separately.
set -euo pipefail

COMMIT_SHORT=0af0241
COMMIT_FULL=0af0241ad7caede90555ac7a8f0c291d98727fc7
TGZ=/tmp/medverse-${COMMIT_SHORT}.tgz
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REL="${STAMP}-${COMMIT_SHORT}-ps-cutover"
DST="/opt/medverse/releases/${REL}"
ROLLBACK="/opt/medverse/releases/20260922T055336Z-43b1784-anon-jwt-rebuild"

PROD_BEFORE="$(readlink -f /opt/medverse/current)"
STG_BEFORE="$(readlink -f /opt/medverse-staging/current)"
PROD_DB="$(sudo -n -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
STG_DB="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
STG_COMMIT="$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"

echo "PROD_BEFORE=$PROD_BEFORE"
echo "STG_BEFORE=$STG_BEFORE"
echo "PROD_DB=$PROD_DB"
echo "STG_DB=$STG_DB"
echo "STG_COMMIT=$STG_COMMIT"
echo "ROLLBACK=$ROLLBACK"

test -d "$ROLLBACK"
test "$PROD_DB" = "20260922000007"
test "$STG_DB" = "20260922000007"
test "$STG_COMMIT" = "0af0241ad7caede90555ac7a8f0c291d98727fc7"

install -d -m 0755 -o medverse -g medverse /opt/medverse/releases
rm -rf "$DST"
mkdir -p "$DST"
tar -xzf "$TGZ" -C "$DST"
echo "$COMMIT_FULL" > "$DST/RELEASE_COMMIT"
chown -R medverse:medverse "$DST"

# Build with production env (must bake production Auth URL, not staging)
set -a
# shellcheck disable=SC1091
source /etc/medverse/nextjs.env
set +a
export NODE_ENV=production

# Guard: never bake staging Auth project into production build
if printf '%s' "${NEXT_PUBLIC_SUPABASE_URL:-}${SUPABASE_URL:-}${E2E_AUTH_URL:-}" | grep -qs 'vygtwrsshcyfahfzurgq'; then
  echo 'REFUSING: staging Auth ref in production env' >&2
  exit 2
fi
if ! printf '%s' "${NEXT_PUBLIC_SUPABASE_URL:-}${SUPABASE_DIRECT_URL:-}" | grep -qs 'pxoxijlhcvbrostrquft'; then
  echo 'REFUSING: production Auth ref missing from env' >&2
  exit 2
fi
echo "AUTH_HOST_OK=$(printf '%s' "${SUPABASE_DIRECT_URL:-$NEXT_PUBLIC_SUPABASE_URL}" | sed -E 's#https://([^/]+).*#\1#')"

sudo -u medverse env \
  HOME=/home/medverse \
  USER=medverse \
  LOGNAME=medverse \
  NODE_ENV=production \
  PATH="/usr/local/bin:/usr/bin:/bin" \
  NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
  SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}" \
  SUPABASE_DIRECT_URL="${SUPABASE_DIRECT_URL:-}" \
  CRON_SECRET="${CRON_SECRET:-}" \
  bash -lc "
set -euo pipefail
cd '$DST'
npm ci --include=dev
npm run build
"

test -f "$DST/.next/BUILD_ID"

# Verify build does not contain staging Auth host string in server chunks
if grep -Rqs 'vygtwrsshcyfahfzurgq' "$DST/.next" 2>/dev/null; then
  echo 'REFUSING: staging Auth ref found in production build output' >&2
  exit 2
fi

# Switch symlink only after build OK
ln -sfn "$DST" /opt/medverse/current
chown -h medverse:medverse /opt/medverse/current

systemctl restart medverse-postgrest.service
systemctl restart medverse-next.service
sleep 4
systemctl is-active medverse-next.service
systemctl is-active medverse-postgrest.service
systemctl is-active caddy.service

PROD_AFTER="$(readlink -f /opt/medverse/current)"
STG_AFTER="$(readlink -f /opt/medverse-staging/current)"
echo "PROD_AFTER=$PROD_AFTER"
echo "STG_AFTER=$STG_AFTER"
echo "PROD_COMMIT=$(cat /opt/medverse/current/RELEASE_COMMIT)"
test "$STG_BEFORE" = "$STG_AFTER"
test "$(cat /opt/medverse/current/RELEASE_COMMIT)" = "$COMMIT_FULL"

curl -fsS https://lms.medversepk.com/api/health
echo
curl -fsS -o /dev/null -w "postgrest_local=%{http_code}\n" http://127.0.0.1:3001/ || true

echo "DEPLOY_OK=$REL"
echo "ROLLBACK_TARGET=$ROLLBACK"
