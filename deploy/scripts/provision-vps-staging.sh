#!/usr/bin/env bash
# Provision same-host staging stack. Must run on the VPS as root.
# Does not modify database `medverse`, production systemd units, or the
# production Caddy site block. Does not enable pg_cron on staging.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 2
fi

STAGING_HOST="${STAGING_HOST:-staging.medversepk.com}"
STAGING_AUTH_HOST="${STAGING_AUTH_HOST:-vygtwrsshcyfahfzurgq.supabase.co}"
ANON_KEY_FILE="${STAGING_ANON_KEY_FILE:-/etc/medverse-staging/anon.key}"
SERVICE_KEY_FILE="${STAGING_SERVICE_KEY_FILE:-/etc/medverse-staging/service_role.key}"
REPO_ROOT="${REPO_ROOT:-/opt/medverse-staging/src}"
UNIT_SRC="${UNIT_SRC:-$REPO_ROOT/deploy}"

if [[ ! -d /etc/medverse ]]; then
  echo "/etc/medverse missing; refusing to invent production" >&2
  exit 2
fi

install -d -m 0750 -o root -g medverse /etc/medverse-staging
install -d -m 0755 -o medverse -g medverse /opt/medverse-staging
ln -sfn /opt/medverse/current /opt/medverse-staging/current

if [[ ! -s "$ANON_KEY_FILE" ]]; then
  echo "missing $ANON_KEY_FILE" >&2
  exit 2
fi
ANON_KEY="$(tr -d '\r\n' <"$ANON_KEY_FILE")"

SERVICE_KEY=""
if [[ -s "$SERVICE_KEY_FILE" ]]; then
  SERVICE_KEY="$(tr -d '\r\n' <"$SERVICE_KEY_FILE")"
fi

# --- database ---
if sudo -u postgres psql -d postgres -Atqc "select 1 from pg_database where datname='medverse_staging'" | grep -q 1; then
  echo "database medverse_staging already exists"
else
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "create database medverse_staging owner postgres;"
fi

install -m 0644 "$UNIT_SRC/postgres/bootstrap_staging_role.sql" /tmp/bootstrap_staging_role.sql
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -f /tmp/bootstrap_staging_role.sql
rm -f /tmp/bootstrap_staging_role.sql
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "revoke all on database medverse_staging from public;"
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "grant connect on database medverse_staging to authenticator_staging;"

PW_FILE=/etc/medverse-staging/authenticator.pw
if [[ ! -s "$PW_FILE" ]]; then
  umask 077
  openssl rand -hex 32 | tr -d '\n' >"$PW_FILE"
  chown root:medverse "$PW_FILE"
  chmod 0640 "$PW_FILE"
fi
python3 - "$PW_FILE" <<'PY'
from pathlib import Path
import sys
pw = Path(sys.argv[1]).read_text().strip().replace("'", "''")
Path("/tmp/alter-authenticator-staging.sql").write_text(
    "alter role authenticator_staging password '%s';\n" % pw, encoding="utf-8"
)
PY
chmod 0640 /tmp/alter-authenticator-staging.sql
chown postgres:postgres /tmp/alter-authenticator-staging.sql
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -f /tmp/alter-authenticator-staging.sql
shred -u /tmp/alter-authenticator-staging.sql || rm -f /tmp/alter-authenticator-staging.sql

export PGDATABASE=medverse_staging PGHOST=127.0.0.1
export MEDVERSE_MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
bash "$UNIT_SRC/scripts/apply-staging-schema.sh"

# --- JWKS from staging Auth (public) ---
curl -fsS "https://${STAGING_AUTH_HOST}/auth/v1/.well-known/jwks.json" \
  -o /etc/medverse-staging/jwks.json
python3 - <<'PY'
import json
from pathlib import Path
p = Path("/etc/medverse-staging/jwks.json")
data = json.loads(p.read_text())
kids = [k.get("kid") for k in data.get("keys", [])]
algs = [k.get("alg") for k in data.get("keys", [])]
if "c32382fb-1d0e-4ae6-ba13-b894a96fd59d" not in kids:
    raise SystemExit(f"unexpected staging JWKS kids={kids}")
if "ES256" not in algs:
    raise SystemExit(f"unexpected staging JWKS algs={algs}")
print("staging JWKS ok", kids)
PY
chown root:medverse /etc/medverse-staging/jwks.json
chmod 0640 /etc/medverse-staging/jwks.json

install -m 0640 -o root -g medverse \
  "$UNIT_SRC/postgrest/postgrest.staging.conf.example" \
  /etc/medverse-staging/postgrest.conf

CRON_FILE=/etc/medverse-staging/cron.secret
if [[ ! -s "$CRON_FILE" ]]; then
  umask 077
  openssl rand -hex 32 >"$CRON_FILE"
  chown root:medverse "$CRON_FILE"
  chmod 0640 "$CRON_FILE"
fi
CRON_SECRET="$(tr -d '\r\n' <"$CRON_FILE")"
AUTH_PW="$(cat "$PW_FILE")"

# nextjs.env
umask 077
{
  echo "MEDVERSE_ENV=vps-staging"
  echo "NEXT_PUBLIC_SUPABASE_URL=https://${STAGING_HOST}"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
  if [[ -n "$SERVICE_KEY" ]]; then
    echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}"
  fi
  echo "CRON_SECRET=${CRON_SECRET}"
  echo "POSTGREST_INTERNAL_URL=http://127.0.0.1:3011"
  echo "R2_BUCKET=medverse-staging-private"
} >/etc/medverse-staging/nextjs.env
chown root:medverse /etc/medverse-staging/nextjs.env
chmod 0640 /etc/medverse-staging/nextjs.env

{
  echo "MEDVERSE_ENV=vps-staging"
  echo "PGRST_DB_URI=postgres://authenticator_staging:${AUTH_PW}@127.0.0.1:5432/medverse_staging"
  echo "PGRST_DB_SCHEMAS=public"
  echo "PGRST_DB_ANON_ROLE=anon"
  echo "PGRST_SERVER_HOST=127.0.0.1"
  echo "PGRST_SERVER_PORT=3011"
  echo "PGRST_DB_POOL=5"
  echo "PGRST_JWT_SECRET=@/etc/medverse-staging/jwks.json"
  echo "PGRST_JWT_AUD=authenticated"
  echo "PGRST_JWT_SECRET_IS_BASE64=false"
} >/etc/medverse-staging/postgrest.env
chown root:medverse /etc/medverse-staging/postgrest.env
chmod 0640 /etc/medverse-staging/postgrest.env
unset AUTH_PW

install -m 0644 "$UNIT_SRC/systemd/medverse-staging-next.service" /etc/systemd/system/medverse-staging-next.service
install -m 0644 "$UNIT_SRC/systemd/medverse-staging-postgrest.service" /etc/systemd/system/medverse-staging-postgrest.service
systemctl daemon-reload
systemctl enable --now medverse-staging-postgrest.service
systemctl enable --now medverse-staging-next.service

# --- Caddy: append staging site if missing; do not rewrite production block ---
CADDY=/etc/caddy/Caddyfile
cp -a "$CADDY" "${CADDY}.bak-8g3"
if grep -q "staging.medversepk.com" "$CADDY"; then
  echo "Caddy already has staging site"
else
  printf '\n' >>"$CADDY"
  cat "$UNIT_SRC/Caddyfile.staging.site" >>"$CADDY"
fi
caddy validate --config "$CADDY"
systemctl reload caddy
cp -a "$CADDY" /etc/medverse/Caddyfile.public

echo "provision-vps-staging complete"
