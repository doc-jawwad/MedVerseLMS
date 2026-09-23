#!/usr/bin/env python3
"""Compare botocore UploadPart presign with a manual SigV4 build."""
import os, hmac, hashlib, datetime, urllib.parse
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
import boto3
from botocore.client import Config

endpoint = f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
bucket = os.environ['R2_BUCKET']
key = "study-content/smoke/presign-compare.pdf"
creds = Credentials(os.environ['R2_ACCESS_KEY_ID'], os.environ['R2_SECRET_ACCESS_KEY'])

s3 = boto3.client(
    's3',
    endpoint_url=endpoint,
    aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
    region_name='auto',
    config=Config(signature_version='s3v4'),
)
mpu = s3.create_multipart_upload(Bucket=bucket, Key=key, ContentType='application/pdf')
upload_id = mpu['UploadId']
print('UPLOAD_ID', upload_id)

url = s3.generate_presigned_url(
    'upload_part',
    Params={'Bucket': bucket, 'Key': key, 'UploadId': upload_id, 'PartNumber': 1},
    ExpiresIn=900,
)
print('BOTO', url)

# Manual sign matching our JS
now = datetime.datetime.utcnow()
amz_date = now.strftime('%Y%m%dT%H%M%SZ')
date_stamp = now.strftime('%Y%m%d')
region = 'auto'
host = urllib.parse.urlparse(endpoint).netloc
credential = f"{os.environ['R2_ACCESS_KEY_ID']}/{date_stamp}/{region}/s3/aws4_request"

def enc(s):
    return urllib.parse.quote(s, safe='-_.~')

pairs = [
    ('X-Amz-Algorithm', 'AWS4-HMAC-SHA256'),
    ('X-Amz-Credential', credential),
    ('X-Amz-Date', amz_date),
    ('X-Amz-Expires', '900'),
    ('X-Amz-SignedHeaders', 'host'),
    ('partNumber', '1'),
    ('uploadId', upload_id),
]
pairs.sort(key=lambda x: x[0])
cq = '&'.join(f"{enc(k)}={enc(v)}" for k, v in pairs)
# Path: encode each segment
uri = '/' + '/'.join(enc(p) for p in f"{bucket}/{key}".split('/'))
canonical_headers = f"host:{host}\n"
canonical_request = "\n".join([
    'PUT',
    uri,
    cq,
    canonical_headers,
    'host',
    'UNSIGNED-PAYLOAD',
])
print('CANONICAL_REQUEST<<<')
print(canonical_request)
print('>>>')
cr_hash = hashlib.sha256(canonical_request.encode()).hexdigest()
sts = "\n".join([
    'AWS4-HMAC-SHA256',
    amz_date,
    f"{date_stamp}/{region}/s3/aws4_request",
    cr_hash,
])
def sign(key, msg):
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()
k = sign(('AWS4' + os.environ['R2_SECRET_ACCESS_KEY']).encode('utf-8'), date_stamp)
k = sign(k, region)
k = sign(k, 's3')
k = sign(k, 'aws4_request')
# fix sign for bytes keys
def signb(key, msg):
    if isinstance(key, str):
        key = key.encode('utf-8')
    if isinstance(msg, str):
        msg = msg.encode('utf-8')
    return hmac.new(key, msg, hashlib.sha256).digest()
kDate = signb('AWS4' + os.environ['R2_SECRET_ACCESS_KEY'], date_stamp)
kRegion = signb(kDate, region)
kService = signb(kRegion, 's3')
kSigning = signb(kService, 'aws4_request')
signature = hmac.new(kSigning, sts.encode('utf-8'), hashlib.sha256).hexdigest()
manual_url = f"{endpoint}{uri}?{cq}&X-Amz-Signature={signature}"
print('MANUAL', manual_url)

# Try PUT with manual URL
import urllib.request
body = b'%PDF-1.4\n' + (b'A' * (8*1024*1024 - 8))
req = urllib.request.Request(manual_url, data=body, method='PUT')
try:
    with urllib.request.urlopen(req) as resp:
        print('MANUAL_PUT', resp.status, resp.headers.get('ETag'))
except Exception as e:
    print('MANUAL_PUT_FAIL', e)
    if hasattr(e, 'read'):
        print(e.read()[:500])

s3.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
