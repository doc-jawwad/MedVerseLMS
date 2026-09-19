#!/usr/bin/env bash
# Production Next deploy for Security Check 3 (auth confirm + headers).
# Restarts only medverse-next. Caddy/UFW applied separately.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 2
fi

COMMIT="627d6b2133d1ad1ebc9c5abadf6fca2e10a26ef2"
SHORT="627d6b2"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-${SHORT}-check3-origin-security"
DST="/opt/medverse/releases/${STAMP}"
TGZ="/tmp/medverse-${SHORT}.tgz"
PREV="$(readlink -f /opt/medverse/current)"
STG_BEFORE="$(readlink -f /opt/medverse-staging/current 2>/dev/null || true)"
UNIT_BEFORE="$(sha256sum /etc/systemd/system/medverse-next.service /etc/systemd/system/medverse-postgrest.service)"
POOL_BEFORE="$(grep -E '^db-pool' /etc/medverse/postgrest.conf)"
HEAD_BEFORE="$(sudo -n -u postgres psql -d medverse -Atc \
  "select coalesce(max(version),'NONE') from supabase_migrations.schema_migrations")"

echo "=== precheck ==="
echo "prev_release=$PREV"
echo "staging_before=${STG_BEFORE}"
[[ -f "$TGZ" ]] || { echo "missing $TGZ" >&2; exit 2; }
if tar -tzf "$TGZ" | grep -E '^(deploy/\.rbac-overlay/|deploy/loadtest/|scripts/load-test/)' >/dev/null; then
  echo "FAIL: unrelated artifacts in archive" >&2
  exit 3
fi
LIST="$(mktemp)"
tar -tzf "$TGZ" >"$LIST"
for marker in \
  'src/lib/http/public-origin.ts' \
  'src/lib/http/safe-internal-path.ts' \
  'src/app/auth/confirm/route.ts' \
  'deploy/scripts/sync-cloudflare-ufw.sh'
do
  grep -Fq "$marker" "$LIST" || { echo "FAIL: missing $marker" >&2; rm -f "$LIST"; exit 3; }
done
rm -f "$LIST"

install -d -m 0755 -o medverse -g medverse "$DST"
tar -xzf "$TGZ" -C "$DST"
echo "$COMMIT" >"$DST/.release-commit"
chown -R medverse:medverse "$DST"

grep -q 'getPublicOrigin' "$DST/src/app/auth/confirm/route.ts" || {
  echo "FAIL: confirm route missing getPublicOrigin" >&2
  exit 3
}
grep -q 'safeInternalPath' "$DST/src/app/auth/confirm/route.ts" || {
  echo "FAIL: confirm route missing safeInternalPath" >&2
  exit 3
}

echo "=== npm ci + build ==="
sudo -u medverse bash -lc "
set -euo pipefail
cd '$DST'
set -a
source /etc/medverse/nextjs.env
set +a
export NODE_ENV=production
npm ci --include=dev
npm run build
"

if ! grep -Rqs 'lms.medversepk.com' "$DST/.next"; then
  echo "FAIL: production origin not baked" >&2
  exit 3
fi
if grep -RoqsE 'https://staging\.medversepk\.com' "$DST/.next"; then
  echo "FAIL: staging origin baked into production .next" >&2
  exit 3
fi

ln -sfn "$DST" /opt/medverse/current
systemctl restart medverse-next.service
systemctl is-active medverse-next.service medverse-postgrest.service

UNIT_AFTER="$(sha256sum /etc/systemd/system/medverse-next.service /etc/systemd/system/medverse-postgrest.service)"
POOL_AFTER="$(grep -E '^db-pool' /etc/medverse/postgrest.conf)"
HEAD_AFTER="$(sudo -n -u postgres psql -d medverse -Atc \
  "select coalesce(max(version),'NONE') from supabase_migrations.schema_migrations")"
[[ "$UNIT_AFTER" == "$UNIT_BEFORE" ]] || { echo "ABORT: units changed" >&2; exit 4; }
[[ "$POOL_AFTER" == "$POOL_BEFORE" ]] || { echo "ABORT: pool changed" >&2; exit 4; }
[[ "$HEAD_AFTER" == "$HEAD_BEFORE" ]] || { echo "ABORT: migration head changed" >&2; exit 4; }
[[ "$(readlink -f /opt/medverse-staging/current)" == "$STG_BEFORE" ]] || {
  echo "ABORT: staging changed" >&2
  exit 4
}

sleep 3
curl -sS -m 8 -w " loopback:%{http_code}\n" http://127.0.0.1:3000/api/health
curl -sS -m 10 -w " public:%{http_code}\n" https://lms.medversepk.com/api/health
echo "prod_after=$(readlink -f /opt/medverse/current)"
echo "release_commit=$(cat $DST/.release-commit)"
echo "rollback_app=ln -sfn $PREV /opt/medverse/current && systemctl restart medverse-next.service"
echo "PROD_APP_OK"
