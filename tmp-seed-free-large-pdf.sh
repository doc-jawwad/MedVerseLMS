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

# Source key from ACC-mudmod8m-D (real PDF)
SRC=$(sudo -u postgres psql -d medverse_staging -Atc "select r2_object_key from materials where id='3d642c22-0eef-43fb-b463-1e58a11f3e1e';")
SIZE=$(sudo -u postgres psql -d medverse_staging -Atc "select r2_byte_size from materials where id='3d642c22-0eef-43fb-b463-1e58a11f3e1e';")
KEY="study-content/smoke/reader-free-$(date +%s).pdf"
echo "SRC=$SRC SIZE=$SIZE"
aws s3api copy-object --bucket "$BUCKET" --copy-source "${BUCKET}/${SRC}" --key "$KEY" --endpoint-url "$ENDPOINT" >/dev/null
FOLDER=$(sudo -u postgres psql -d medverse_staging -Atc "select folder_id from materials where id='35182e79-9576-4864-8725-7473072427d5';")
MAT=$(sudo -u postgres psql -d medverse_staging -Atc "insert into materials (folder_id, title, description, file_type, kind, status, r2_object_key, r2_content_type, r2_byte_size) values ('${FOLDER}', 'Range Reader Free 20MB', 'copied ACC fixture for free-folder range tests', 'pdf', 'pdf', 'published', '${KEY}', 'application/pdf', ${SIZE}) returning id;")
echo "MATERIAL=$MAT KEY=$KEY"
echo "$MAT" > /tmp/last-reader-material.txt
