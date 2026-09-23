#!/bin/bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/medverse-staging/nextjs.env
set +a
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
MID="${1:?material id}"

ROW=$(sudo -u postgres psql -d medverse_staging -Atc \
  "select id || '|' || coalesce(title,'') || '|' || coalesce(r2_object_key,'') || '|' || coalesce(r2_byte_size::text,'') from materials where id='${MID}';")
echo "ROW=${ROW}"
KEY=$(echo "$ROW" | cut -d'|' -f3)
BYTES=$(echo "$ROW" | cut -d'|' -f4)
echo "KEY=${KEY}"
echo "DB_BYTES=${BYTES}"

echo "--- head-object ---"
HEAD_JSON=$(aws s3api head-object --bucket "$R2_BUCKET" --key "$KEY" --endpoint-url "$ENDPOINT" --output json)
echo "$HEAD_JSON"
CL=$(echo "$HEAD_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ContentLength',''))")
CT=$(echo "$HEAD_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ContentType',''))")
AR=$(echo "$HEAD_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('AcceptRanges',''))")
PC=$(echo "$HEAD_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('PartsCount',''))")
echo "ContentLength=${CL}"
echo "ContentType=${CT}"
echo "AcceptRanges=${AR}"
echo "PartsCount=${PC}"

echo "--- magic bytes via Range GET (first 5) ---"
TMP=$(mktemp)
aws s3api get-object --bucket "$R2_BUCKET" --key "$KEY" --range bytes=0-4 \
  --endpoint-url "$ENDPOINT" "$TMP" >/dev/null
xxd -l 5 "$TMP"
MAGIC=$(xxd -p -l 5 "$TMP")
rm -f "$TMP"
echo "MAGIC_HEX=${MAGIC}"
case "$MAGIC" in
  255044462d*) echo "MAGIC_OK=yes" ;;
  *) echo "MAGIC_OK=no"; exit 2 ;;
esac

echo "--- protected reader URL shape ---"
# App serves via /api/study-content/<id> — confirm no public R2 URL in DB key path
case "$KEY" in
  *http*|*r2.cloudflarestorage.com*) echo "PUBLIC_URL_LEAK=yes"; exit 3 ;;
  *) echo "PUBLIC_URL_LEAK=no" ;;
esac

PID=$(systemctl show medverse-staging-next.service -p MainPID --value)
echo "NOW_RSS_KB=$(ps -o rss= -p "$PID" | tr -d ' ')"
echo "TMP_MB=$(du -sm /tmp 2>/dev/null | cut -f1)"
echo "PROD=$(cat /opt/medverse/current/RELEASE_COMMIT)"
echo "STG=$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"

# Find largest /tmp files related to pdf (should not be ~material size)
echo "--- large /tmp files (>50MB) ---"
find /tmp -type f -size +50M 2>/dev/null | head -20 || true
du -sh /tmp 2>/dev/null || true
