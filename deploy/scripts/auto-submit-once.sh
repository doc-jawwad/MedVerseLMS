#!/usr/bin/env bash
# Backup sweeper for pg_cron (docs/deployment.md). Invoked by systemd.
# pg_cron remains the primary every-minute job.
#
# 1) Local SQL (VPS): same function pg_cron runs. No PostgREST, no API keys.
# 2) HTTP fallback: Next.js /api/cron/auto-submit — only works when
#    SUPABASE_SERVICE_ROLE_KEY is a JWT (managed Supabase). Opaque sb_* keys
#    are rejected by that route.
set -euo pipefail

DBNAME="${MEDVERSE_DATABASE:-medverse}"

if sudo -n -u postgres psql -d "$DBNAME" -Atqc "select 1" >/dev/null 2>&1; then
  sudo -n -u postgres psql -d "$DBNAME" -v ON_ERROR_STOP=1 -Atqc \
    "select public.auto_submit_expired();"
  exit 0
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "auto-submit: local psql unavailable and CRON_SECRET is not set" >&2
  exit 1
fi

# Header from env, not from argv of this wrapper's callers.
exec curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  http://127.0.0.1:3000/api/cron/auto-submit
