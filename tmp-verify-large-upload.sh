#!/bin/bash
set -euo pipefail
set -a
source /etc/medverse-staging/nextjs.env
set +a
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
MID="${1:?material id}"
LOG="${2:-/tmp/rss-u500.log}"

ROW=$(sudo -u postgres psql -d medverse_staging -Atc "select id || '|' || title || '|' || r2_object_key || '|' || r2_byte_size from materials where id='$MID';")
echo "ROW=$ROW"
KEY=$(echo "$ROW" | cut -d'|' -f3)
echo "KEY=$KEY"
aws s3api head-object --bucket "$R2_BUCKET" --key "$KEY" --endpoint-url "$ENDPOINT"
PID=$(systemctl show medverse-staging-next.service -p MainPID --value)
echo "NOW_RSS_KB=$(ps -o rss= -p "$PID" | tr -d ' ')"
echo "TMP_MB=$(du -sm /tmp 2>/dev/null | cut -f1)"
echo "--- rss unique ---"
grep -oE 'rss_kb=[0-9]+' "$LOG" 2>/dev/null | sort | uniq -c || true
grep -oE 'tmp_mb=[0-9]+' "$LOG" 2>/dev/null | sort | uniq -c || true
echo "PROD=$(cat /opt/medverse/current/RELEASE_COMMIT)"
echo "STG=$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"
