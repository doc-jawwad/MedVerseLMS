#!/usr/bin/env bash
# Sync UFW HTTPS allow-rules from Cloudflare's live published IP lists.
# Does NOT hardcode ranges — fetches https://www.cloudflare.com/ips-v4|ips-v6.
# Preserves SSH (22). Rollback: deploy/scripts/rollback-cloudflare-ufw.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 2
fi

MARKER="cf-medverse-https"
V4_URL="https://www.cloudflare.com/ips-v4"
V6_URL="https://www.cloudflare.com/ips-v6"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch_list() {
  local url="$1" out="$2"
  curl -fsS --max-time 30 "$url" | tr -d '\r' | awk 'NF && $1 !~ /^#/' >"$out"
  local n
  n="$(wc -l <"$out" | tr -d ' ')"
  if [[ "$n" -lt 5 ]]; then
    echo "FAIL: too few ranges from $url (n=$n)" >&2
    exit 3
  fi
}

echo "=== fetch Cloudflare IP lists ==="
fetch_list "$V4_URL" "$TMP/v4"
fetch_list "$V6_URL" "$TMP/v6"
echo "v4_ranges=$(wc -l <"$TMP/v4" | tr -d ' ')"
echo "v6_ranges=$(wc -l <"$TMP/v6" | tr -d ' ')"

# Ensure UFW is active and SSH remains allowed before touching 443.
ufw status | grep -q "Status: active" || {
  echo "FAIL: ufw not active" >&2
  exit 4
}
if ! ufw status numbered | grep -Eq '22/tcp.*ALLOW'; then
  echo "=== ensure SSH allow ==="
  ufw allow 22/tcp comment 'SSH'
fi

echo "=== remove previous $MARKER / open-443 rules ==="
# Delete numbered rules matching our marker or unrestricted 443 (repeat until gone).
i=0
while [[ $i -lt 80 ]]; do
  i=$((i + 1))
  line="$(ufw status numbered | grep -E '^\[[0-9]+\] 443/tcp' | grep -E 'Anywhere( \(v6\))?[[:space:]]*(# HTTPS)?$' | grep -v "$MARKER" | head -1 || true)"
  if [[ -z "$line" ]]; then
    # also remove prior marker rules before re-add
    line="$(ufw status numbered | grep -F "$MARKER" | head -1 || true)"
  fi
  [[ -z "$line" ]] && break
  num="$(echo "$line" | sed -n 's/^\[\([0-9]\+\)\].*/\1/p')"
  [[ -n "$num" ]] || break
  ufw --force delete "$num" >/dev/null
done

echo "=== add Cloudflare HTTPS allows ==="
while read -r cidr; do
  [[ -z "$cidr" ]] && continue
  ufw allow from "$cidr" to any port 443 proto tcp comment "$MARKER"
done <"$TMP/v4"
while read -r cidr; do
  [[ -z "$cidr" ]] && continue
  ufw allow from "$cidr" to any port 443 proto tcp comment "$MARKER"
done <"$TMP/v6"

echo "=== status (redacted counts) ==="
echo "ssh_allows=$(ufw status | grep -c '22/tcp' || true)"
echo "cf_https_allows=$(ufw status | grep -c "$MARKER" || true)"
echo "open_443_anywhere=$(ufw status | grep -E '443/tcp.*Anywhere' | grep -vc "$MARKER" || true)"
echo "CF_UFW_SYNC_OK"
