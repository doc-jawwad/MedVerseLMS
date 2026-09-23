#!/bin/bash
# Insert a free-folder PDF material pointing at a freshly uploaded R2 object for range API tests.
set -euo pipefail
set -a
source /etc/medverse-staging/nextjs.env
set +a

BYTES="${1:-209715200}"
KEY="study-content/smoke/reader-$(date +%s)-${BYTES}.pdf"
node /tmp/r2-multipart-smoke.mjs "$BYTES" >/tmp/r2-upload-out.json || true
# multipart smoke deletes object — use dedicated upload keep
python3 - <<PY
import os, hmac, hashlib, datetime, urllib.parse, uuid, subprocess, json
from pathlib import Path

account=os.environ['R2_ACCOUNT_ID']
ak=os.environ['R2_ACCESS_KEY_ID']
sk=os.environ['R2_SECRET_ACCESS_KEY']
bucket=os.environ.get('R2_PAYMENT_BUCKET') or os.environ['R2_BUCKET']
endpoint=f'https://{account}.r2.cloudflarestorage.com'
bytes_n=int(os.environ.get('BYTES','209715200'))
key=os.environ['KEY']

# Prefer aws cli mp for large files
part=f'/tmp/reader-part.bin'
# write header pdf then pad with truncate
open(part,'wb').write(b'%PDF-1.4\\n')
os.truncate(part, bytes_n)
print('local', os.path.getsize(part))
PY
