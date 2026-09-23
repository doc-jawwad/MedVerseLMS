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
KEY="study-content/smoke/presign-probe.pdf"
UPLOAD_ID=$(aws s3api create-multipart-upload --bucket "$BUCKET" --key "$KEY" --content-type application/pdf --endpoint-url "$ENDPOINT" --query UploadId --output text)
export UPLOAD_ID
python3 - <<'PY'
import os, boto3
from botocore.client import Config
endpoint=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
s3=boto3.client('s3',
  endpoint_url=endpoint,
  aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
  aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
  region_name='auto',
  config=Config(signature_version='s3v4'))
url=s3.generate_presigned_url('upload_part', Params={
  'Bucket': os.environ['R2_BUCKET'],
  'Key': 'study-content/smoke/presign-probe.pdf',
  'UploadId': os.environ['UPLOAD_ID'],
  'PartNumber': 1,
}, ExpiresIn=900)
print('BOTO_URL='+url)
PY
aws s3api abort-multipart-upload --bucket "$BUCKET" --key "$KEY" --upload-id "$UPLOAD_ID" --endpoint-url "$ENDPOINT"
echo DONE
