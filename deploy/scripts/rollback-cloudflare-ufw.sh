#!/usr/bin/env bash
# Rollback Cloudflare-only 443: restore unrestricted HTTPS allow (pre Check-3).
# Keeps SSH. Does not touch Caddy/Next/Postgres.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 2
fi

MARKER="cf-medverse-https"
i=0
while [[ $i -lt 80 ]]; do
  i=$((i + 1))
  mapfile -t lines < <(ufw status numbered | sed -n 's/^\[\([0-9]\+\)\][[:space:]]\+\(.*\)$/\1|\2/p')
  del=""
  for line in "${lines[@]}"; do
    num="${line%%|*}"
    rest="${line#*|}"
    if echo "$rest" | grep -Fq "$MARKER"; then
      del="$num"
      break
    fi
  done
  [[ -z "$del" ]] && break
  ufw --force delete "$del" >/dev/null
done

ufw allow 443/tcp comment 'HTTPS'
echo "ROLLBACK_CF_UFW_OK"
ufw status | head -30
