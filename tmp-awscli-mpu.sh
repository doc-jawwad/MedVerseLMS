#!/bin/bash
set -euo pipefail
set -a
source /etc/medverse-staging/nextjs.env
set +a
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
BUCKET="$R2_BUCKET"
KEY="study-content/smoke/awscli-mpu-$(date +%s).pdf"
dd if=/dev/zero of=/tmp/mpu-part.bin bs=1M count=8 status=none
# Make first bytes look like PDF for later checks
printf '%%PDF-1.4\n' | dd of=/tmp/mpu-part.bin conv=notrunc status=none
echo "create multipart"
UPLOAD_ID=$(aws s3api create-multipart-upload --bucket "$BUCKET" --key "$KEY" --content-type application/pdf --endpoint-url "$ENDPOINT" --query UploadId --output text)
echo "UPLOAD_ID_LEN=${#UPLOAD_ID}"
echo "upload part 1"
ETAG=$(aws s3api upload-part --bucket "$BUCKET" --key "$KEY" --part-number 1 --body /tmp/mpu-part.bin --upload-id "$UPLOAD_ID" --endpoint-url "$ENDPOINT" --query ETag --output text)
echo "ETAG=$ETAG"
echo "complete"
aws s3api complete-multipart-upload --bucket "$BUCKET" --key "$KEY" --upload-id "$UPLOAD_ID" --multipart-upload "file:///tmp/mpu-complete.json" --endpoint-url "$ENDPOINT" 2>/tmp/mpu-complete.err || true
# write complete json
printf '{"Parts":[{"ETag":%s,"PartNumber":1}]}' "$ETAG" > /tmp/mpu-complete.json
# ETag needs quotes in JSON
python3 - <<PY
import json
etag=open('/tmp/mpu-etag.txt','w')
PY
python3 -c "import json; print(json.dumps({'Parts':[{'ETag':'''$ETAG''','PartNumber':1}]}))" > /tmp/mpu-complete.json
aws s3api complete-multipart-upload --bucket "$BUCKET" --key "$KEY" --upload-id "$UPLOAD_ID" --multipart-upload "file:///tmp/mpu-complete.json" --endpoint-url "$ENDPOINT"
aws s3api head-object --bucket "$BUCKET" --key "$KEY" --endpoint-url "$ENDPOINT"
aws s3api delete-object --bucket "$BUCKET" --key "$KEY" --endpoint-url "$ENDPOINT"
echo AWSCLI_MPU_OK
