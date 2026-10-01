#!/usr/bin/env bash
# VPS primary R2 purge queue consumer (Content bin).
# claim_r2_purge_batch / complete_r2_purge via local psql; R2 DELETE via boto3.
# Staging: MEDVERSE_DATABASE=medverse_staging
# Production: MEDVERSE_DATABASE=medverse (default)
#
# HTTP fallback: GET /api/cron/r2-purge (JWT service role only).
set -euo pipefail

DBNAME="${MEDVERSE_DATABASE:-medverse}"
LIMIT="${R2_PURGE_LIMIT:-50}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_PY="${SCRIPT_DIR}/r2-purge-worker.py"

if [[ ! -f "$WORKER_PY" ]]; then
  echo "r2-purge: missing worker ${WORKER_PY}" >&2
  exit 1
fi

if sudo -n -u postgres psql -d "$DBNAME" -Atqc "select 1" >/dev/null 2>&1; then
  if [[ -z "${R2_ACCOUNT_ID:-}" || -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" ]]; then
    echo "r2-purge: R2 credentials missing in environment" >&2
    exit 1
  fi
  BUCKET="${R2_PAYMENT_BUCKET:-${R2_BUCKET:-}}"
  if [[ -z "$BUCKET" ]]; then
    echo "r2-purge: R2_PAYMENT_BUCKET/R2_BUCKET unset" >&2
    exit 1
  fi
  # Refuse obvious production bucket when targeting staging DB (and vice versa).
  if [[ "$DBNAME" == "medverse_staging" && "$BUCKET" == *prod* ]]; then
    echo "r2-purge: refusing production-looking bucket against staging DB" >&2
    exit 2
  fi
  if [[ "$DBNAME" == "medverse" && "$BUCKET" == *staging* ]]; then
    echo "r2-purge: refusing staging-looking bucket against production DB" >&2
    exit 2
  fi

  export MEDVERSE_DATABASE="$DBNAME"
  export R2_PURGE_LIMIT="$LIMIT"
  export R2_BUCKET_EFFECTIVE="$BUCKET"
  exec python3 "$WORKER_PY"
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "r2-purge: local psql unavailable and CRON_SECRET is not set" >&2
  exit 1
fi

PORT="${MEDVERSE_NEXT_PORT:-3000}"
exec curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://127.0.0.1:${PORT}/api/cron/r2-purge?limit=${LIMIT}"
