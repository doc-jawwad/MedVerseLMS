#!/usr/bin/env bash
# Soft-deleted Content Bin expiry sweeper (deleted_at + 7 days → hard delete).
# Prefer local psql (VPS). Staging has no pg_cron; production may use pg_cron
# job medverse-purge-bin plus this timer as backup.
set -euo pipefail

DBNAME="${MEDVERSE_DATABASE:-medverse}"

if sudo -n -u postgres psql -d "$DBNAME" -Atqc "select 1" >/dev/null 2>&1; then
  sudo -n -u postgres psql -d "$DBNAME" -v ON_ERROR_STOP=1 \
    -c "select public.purge_expired_bin_items();"
  exit 0
fi

echo "purge-expired-bin: local psql unavailable for ${DBNAME}" >&2
exit 1
