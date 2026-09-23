#!/bin/bash
set -a
source /etc/medverse-staging/nextjs.env
set +a
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
# CORS preflight probe (no auth needed for OPTIONS)
curl -sI -X OPTIONS \
  -H "Origin: https://staging.medversepk.com" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  "${ENDPOINT}/${R2_BUCKET}/study-content/cors-probe" | tr -d '\r'
echo "---"
curl -sI -X OPTIONS \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  "${ENDPOINT}/${R2_BUCKET}/study-content/cors-probe" | tr -d '\r'
