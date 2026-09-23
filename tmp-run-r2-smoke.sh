#!/bin/bash
# Run R2 multipart smoke sizes on staging host (no Postgres, deletes objects).
set -euo pipefail
set -a
source /etc/medverse-staging/nextjs.env
set +a
cd /tmp
SIZES=(
  $((5 * 1024 * 1024))
  $((25 * 1024 * 1024))
  $((50 * 1024 * 1024))
  $((100 * 1024 * 1024))
  $((200 * 1024 * 1024))
  $((500 * 1024 * 1024))
  $((1024 * 1024 * 1024))
)
for b in "${SIZES[@]}"; do
  echo "===== SMOKE bytes=$b ====="
  /usr/bin/time -f 'TIME_SEC=%e MAX_RSS_KB=%M' node /tmp/r2-multipart-smoke.mjs "$b"
done
echo ALL_SMOKE_OK
