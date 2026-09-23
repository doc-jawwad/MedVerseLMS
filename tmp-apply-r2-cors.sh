#!/bin/bash
set -euo pipefail
set -a
source /etc/medverse-staging/nextjs.env
set +a
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
BUCKET="${R2_PAYMENT_BUCKET:-$R2_BUCKET}"
echo "BUCKET=$BUCKET ENDPOINT=$ENDPOINT"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file:///tmp/tmp-r2-cors.json --endpoint-url "$ENDPOINT"
aws s3api get-bucket-cors --bucket "$BUCKET" --endpoint-url "$ENDPOINT"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///tmp/tmp-r2-lifecycle.json --endpoint-url "$ENDPOINT"
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --endpoint-url "$ENDPOINT"
echo CORS_OK
