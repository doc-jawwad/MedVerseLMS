#!/bin/bash
# Sample staging-next RSS + /tmp size while a large upload runs.
set -euo pipefail
OUT="${1:-/tmp/rss-large.log}"
PID=$(systemctl show medverse-staging-next.service -p MainPID --value)
echo "BASE PID=$PID rss=$(ps -o rss= -p "$PID" | tr -d ' ') tmp=$(du -sm /tmp 2>/dev/null | cut -f1)" | tee "$OUT"
# Run up to ~40 minutes
for i in $(seq 1 480); do
  echo "$(date -u +%H:%M:%S) rss_kb=$(ps -o rss= -p "$PID" | tr -d ' ') tmp_mb=$(du -sm /tmp 2>/dev/null | cut -f1)" >> "$OUT"
  sleep 5
done
