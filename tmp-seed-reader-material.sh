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
KEY="study-content/smoke/reader-100m-$(date +%s).pdf"
# Reuse existing object if KEY file from prior run
if [[ -f /tmp/last-reader-key.txt ]]; then
  KEY=$(cat /tmp/last-reader-key.txt)
  echo "REUSING=$KEY"
else
  dd if=/dev/zero of=/tmp/reader-100m.pdf bs=1M count=100 status=none
  printf '%%PDF-1.4\n' | dd of=/tmp/reader-100m.pdf conv=notrunc status=none
  aws s3api put-object --bucket "$BUCKET" --key "$KEY" --body /tmp/reader-100m.pdf --content-type application/pdf --endpoint-url "$ENDPOINT" >/dev/null
  echo "$KEY" > /tmp/last-reader-key.txt
  rm -f /tmp/reader-100m.pdf
  echo "UPLOADED=$KEY"
fi
FOLDER=$(sudo -u postgres psql -d medverse_staging -Atc "select folder_id from materials where id = '35182e79-9576-4864-8725-7473072427d5';")
echo "FOLDER=$FOLDER"
MAT=$(sudo -u postgres psql -d medverse_staging -Atc "insert into materials (folder_id, title, description, file_type, kind, status, r2_object_key, r2_content_type, r2_byte_size) values ('${FOLDER}', 'Range Reader 100MB', 'staging range test', 'pdf', 'pdf', 'published', '${KEY}', 'application/pdf', 104857600) returning id;")
echo "MATERIAL=$MAT"
echo "$MAT" > /tmp/last-reader-material.txt
