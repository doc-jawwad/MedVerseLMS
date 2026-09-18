#!/bin/bash
# Build a staging Next.js release under /opt/medverse-staging only.
# Does not write to /opt/medverse/current. Run as root.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 2
fi

PROD_REL="$(readlink -f /opt/medverse/current)"
if [[ ! -d "$PROD_REL" ]]; then
  echo "missing production release" >&2
  exit 2
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DST="/opt/medverse-staging/releases/${STAMP}-origin"
install -d -m 0755 -o medverse -g medverse /opt/medverse-staging/releases
echo "copy $PROD_REL -> $DST (read-only wrt production tree)"
rsync -a --exclude .next --exclude node_modules --exclude .git "$PROD_REL/" "$DST/"
chown -R medverse:medverse "$DST"

echo "build with staging EnvironmentFile"
sudo -u medverse bash -lc "
set -euo pipefail
cd '$DST'
set -a
# shellcheck disable=SC1091
source /etc/medverse-staging/nextjs.env
set +a
export NODE_ENV=production
npm ci --include=dev
npm run build
"

echo "assert baked public origin"
if ! grep -Rqs 'staging.medversepk.com' "$DST/.next"; then
  echo "FAIL: staging origin not found in .next" >&2
  exit 3
fi
if grep -Rqs 'lms.medversepk.com' "$DST/.next"; then
  echo "FAIL: production origin baked into staging .next" >&2
  exit 3
fi
if grep -Rqs 'pxoxijlhcvbrostrquft' "$DST/.next"; then
  echo "FAIL: production Auth ref baked into staging .next" >&2
  exit 3
fi
echo "baked origin ok"

ln -sfn "$DST" /opt/medverse-staging/current
install -m 0644 /opt/medverse-staging/src/deploy/systemd/medverse-staging-next.service \
  /etc/systemd/system/medverse-staging-next.service
# Prefer the just-written unit from this tree if present
if [[ -f "$DST/deploy/systemd/medverse-staging-next.service" ]]; then
  install -m 0644 "$DST/deploy/systemd/medverse-staging-next.service" \
    /etc/systemd/system/medverse-staging-next.service
fi
# Force WorkingDirectory even if copied unit is stale
python3 - <<'PY'
from pathlib import Path
p = Path("/etc/systemd/system/medverse-staging-next.service")
t = p.read_text()
t = t.replace("WorkingDirectory=/opt/medverse/current", "WorkingDirectory=/opt/medverse-staging/current")
if "WorkingDirectory=/opt/medverse-staging/current" not in t:
    raise SystemExit("staging unit missing staging WorkingDirectory")
p.write_text(t)
print("unit WorkingDirectory=/opt/medverse-staging/current")
PY
systemctl daemon-reload
echo "restart staging units only"
systemctl restart medverse-staging-postgrest.service
systemctl restart medverse-staging-next.service
systemctl is-active medverse-staging-postgrest.service medverse-staging-next.service
echo "build-and-restart complete $DST"
