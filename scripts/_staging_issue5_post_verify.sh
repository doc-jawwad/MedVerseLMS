#!/usr/bin/env bash
# Staging-ONLY Issue 5 post-deploy verification:
# 1) soft-delete authorize with populated R2 key
# 2) Content Bin hard-delete → R2 purge (unreferenced deleted; referenced retained)
# Synthetic fixtures only under study-content/issue5-fixture/. Never production.
set -euo pipefail

DB=medverse_staging
[[ "$(hostname)" == * ]] || true

psql_stg() {
  sudo -n -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

die() { echo "FAIL: $*" >&2; exit 1; }

# Refuse production DB / paths
[[ "$DB" == "medverse_staging" ]] || die "refusing DB=$DB"
[[ -f /etc/medverse-staging/nextjs.env ]] || die "missing staging env"
grep -q 'staging.medversepk.com' /etc/medverse-staging/nextjs.env || die "staging origin missing"
grep -q 'lms.medversepk.com' /etc/medverse-staging/nextjs.env && die "prod origin in staging env"

PROD_BEFORE="$(readlink -f /opt/medverse/current)"
STG_SHA="$(tr -d '[:space:]' </opt/medverse-staging/current/RELEASE_COMMIT)"
echo "STAGING_SHA=$STG_SHA"
echo "PROD_CURRENT=$PROD_BEFORE"

# Load R2 via python (from staging env)
python3 - <<'PY' >/tmp/issue5_r2_setup.json
import json, os, uuid, boto3
from botocore.exceptions import ClientError

env={}
with open("/etc/medverse-staging/nextjs.env") as f:
    for line in f:
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v=line.split("=",1)
        env[k]=v.strip().strip('"').strip("'")

bucket=env.get("R2_PAYMENT_BUCKET") or env.get("R2_BUCKET")
assert bucket and "staging" in bucket and "prod" not in bucket, f"unsafe bucket: {bucket}"
account=env["R2_ACCOUNT_ID"]
client=boto3.client(
    "s3",
    endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
    aws_access_key_id=env["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
)

stamp=uuid.uuid4().hex[:12]
key_orphan=f"study-content/issue5-fixture/{stamp}-orphan.pdf"
key_shared=f"study-content/issue5-fixture/{stamp}-shared.pdf"
body=b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nissue5-fixture\n"

for key in (key_orphan, key_shared):
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/pdf")
    client.head_object(Bucket=bucket, Key=key)

print(json.dumps({
    "bucket": bucket,
    "key_orphan": key_orphan,
    "key_shared": key_shared,
    "stamp": stamp,
}))
PY

eval "$(python3 - <<'PY'
import json
d=json.load(open("/tmp/issue5_r2_setup.json"))
print(f"KEY_ORPHAN={d['key_orphan']}")
print(f"KEY_SHARED={d['key_shared']}")
print(f"BUCKET={d['bucket']}")
print(f"STAMP={d['stamp']}")
PY
)"

echo "FIXTURE_KEYS orphan=$KEY_ORPHAN shared=$KEY_SHARED bucket=$BUCKET"

# Create DB fixtures as postgres
YEAR_ID=$(psql_stg -Atqc "select y.id::text from public.years y join public.subjects s on s.year_id=y.id order by y.name, s.name limit 1")
SUBJECT_ID=$(psql_stg -Atqc "select s.id::text from public.years y join public.subjects s on s.year_id=y.id order by y.name, s.name limit 1")
[[ -n "$YEAR_ID" && -n "$SUBJECT_ID" ]] || die "no year/subject"

TITLE_SOFT="ISSUE5-SOFTDEL-FIXTURE ${STAMP}"
TITLE_ORPHAN="ISSUE5-PURGE-ORPHAN ${STAMP}"
TITLE_KEEP_A="ISSUE5-PURGE-KEEP-A ${STAMP}"
TITLE_KEEP_B="ISSUE5-PURGE-KEEP-B ${STAMP}"

SOFT_ID=$(psql_stg -Atqc "
insert into public.one_liners (year_id, subject_id, title, body, status, sort_order, r2_object_key, r2_content_type, r2_byte_size)
values ('$YEAR_ID'::uuid, '$SUBJECT_ID'::uuid, '$TITLE_SOFT', 'soft-delete authz fixture', 'published', 0,
        '$KEY_ORPHAN', 'application/pdf', 64)
returning id::text;
")
# Note: soft-delete uses KEY_ORPHAN temporarily; we'll soft-delete that row without purging first for authz test,
# then use separate rows for purge. Actually KEY_ORPHAN is on SOFT_ID — for purge orphan use a different key.
# Recreate: soft-delete fixture gets its own key; purge orphan gets KEY_ORPHAN; shared uses KEY_SHARED.

# Fix: update SOFT to use a dedicated soft key instead
KEY_SOFT="study-content/issue5-fixture/${STAMP}-softdel.pdf"
python3 - <<PY
import boto3
env={}
with open("/etc/medverse-staging/nextjs.env") as f:
    for line in f:
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v=line.split("=",1); env[k]=v.strip().strip('"').strip("'")
bucket=env.get("R2_PAYMENT_BUCKET") or env.get("R2_BUCKET")
c=boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
  aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
c.put_object(Bucket=bucket, Key="$KEY_SOFT", Body=b"%PDF-1.4 soft\\n", ContentType="application/pdf")
print("soft_key_put_ok")
PY

psql_stg -Atqc "update public.one_liners set r2_object_key='$KEY_SOFT', r2_byte_size=16 where id='$SOFT_ID'::uuid;"

ORPHAN_ID=$(psql_stg -Atqc "
insert into public.one_liners (year_id, subject_id, title, body, status, sort_order, r2_object_key, r2_content_type, r2_byte_size)
values ('$YEAR_ID'::uuid, '$SUBJECT_ID'::uuid, '$TITLE_ORPHAN', 'purge orphan fixture', 'published', 0,
        '$KEY_ORPHAN', 'application/pdf', 64)
returning id::text;
")

KEEP_A=$(psql_stg -Atqc "
insert into public.one_liners (year_id, subject_id, title, body, status, sort_order, r2_object_key, r2_content_type, r2_byte_size)
values ('$YEAR_ID'::uuid, '$SUBJECT_ID'::uuid, '$TITLE_KEEP_A', 'shared key A', 'published', 0,
        '$KEY_SHARED', 'application/pdf', 64)
returning id::text;
")

KEEP_B=$(psql_stg -Atqc "
insert into public.one_liners (year_id, subject_id, title, body, status, sort_order, r2_object_key, r2_content_type, r2_byte_size)
values ('$YEAR_ID'::uuid, '$SUBJECT_ID'::uuid, '$TITLE_KEEP_B', 'shared key B', 'published', 0,
        '$KEY_SHARED', 'application/pdf', 64)
returning id::text;
")

echo "IDS soft=$SOFT_ID orphan=$ORPHAN_ID keepA=$KEEP_A keepB=$KEEP_B"

# --- Test A: soft-delete with populated R2; authorize must deny ---
psql_stg -c "
update public.one_liners
set deleted_at = now(), purge_after = now() + interval '30 days'
where id = '$SOFT_ID'::uuid;
"
KEY_STILL=$(psql_stg -Atqc "select r2_object_key from public.one_liners where id='$SOFT_ID'::uuid")
[[ "$KEY_STILL" == "$KEY_SOFT" ]] || die "soft-delete cleared r2 key unexpectedly: $KEY_STILL"
echo "SOFT_DELETE_KEY_POPULATED=$KEY_STILL"

set +e
DENY_OUT=$(psql_stg -Atqc "select public.authorize_one_liner_object('$SOFT_ID'::uuid)" 2>&1)
DENY_EC=$?
set -e
echo "AUTHORIZE_SOFT_DELETED_EC=$DENY_EC"
echo "AUTHORIZE_SOFT_DELETED_OUT=$DENY_OUT"
echo "$DENY_OUT" | grep -q one_liner_object_denied || die "expected one_liner_object_denied"
[[ "$DENY_EC" -ne 0 ]] || die "authorize unexpectedly succeeded after soft-delete"
echo "PASS soft_delete_authorize_with_populated_r2"

# --- Test B: hard-delete orphan → enqueue → purge deletes R2 ---
# Soft-delete orphan then purge_content as admin
psql_stg -c "
update public.one_liners
set deleted_at = now(), purge_after = now() + interval '30 days'
where id = '$ORPHAN_ID'::uuid;
"

ADMIN_ID=$(psql_stg -Atqc "select id::text from public.profiles where role='admin' or is_main_admin order by created_at limit 1")
[[ -n "$ADMIN_ID" ]] || die "no admin profile"

psql_stg -c "
begin;
select set_config('request.jwt.claims', json_build_object('sub', '$ADMIN_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.purge_content('one_liner', '$ORPHAN_ID'::uuid);
commit;
"

QUEUED=$(psql_stg -Atqc "select count(*) from public.r2_purge_queue where object_key='$KEY_ORPHAN'")
echo "ORPHAN_QUEUED=$QUEUED"
[[ "$QUEUED" -ge 1 ]] || die "orphan key not enqueued"

# Soft-delete KEEP_A only; KEEP_B still references KEY_SHARED
psql_stg -c "
update public.one_liners
set deleted_at = now(), purge_after = now() + interval '30 days'
where id = '$KEEP_A'::uuid;
"
psql_stg -c "
begin;
select set_config('request.jwt.claims', json_build_object('sub', '$ADMIN_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.purge_content('one_liner', '$KEEP_A'::uuid);
commit;
"

# Shared key should NOT be queued (still referenced by KEEP_B)
SHARED_ANY=$(psql_stg -Atqc "select count(*) from public.r2_purge_queue where object_key='$KEY_SHARED'")
REF=$(psql_stg -Atqc "select public.r2_object_still_referenced('$KEY_SHARED')")
echo "SHARED_QUEUED_ANY=$SHARED_ANY REF_STILL=$REF"
[[ "$REF" == "t" ]] || die "shared key should still be referenced"
# enqueue_r2_purge_if_unreferenced should skip — expect 0 rows for shared
[[ "$SHARED_ANY" == "0" ]] || die "shared key was incorrectly enqueued"

# Drain staging purge worker
set +e
bash -lc 'set -a; source /etc/medverse-staging/nextjs.env; set +a; export MEDVERSE_DATABASE=medverse_staging R2_PURGE_LIMIT=50; bash /opt/medverse-staging/current/deploy/scripts/r2-purge-once.sh'
PURGE_EC=$?
set -e
echo "PURGE_WORKER_EC=$PURGE_EC"

# HEAD checks
python3 - <<PY
import json, boto3
from botocore.exceptions import ClientError
env={}
with open("/etc/medverse-staging/nextjs.env") as f:
    for line in f:
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v=line.split("=",1); env[k]=v.strip().strip('"').strip("'")
bucket=env.get("R2_PAYMENT_BUCKET") or env.get("R2_BUCKET")
c=boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
  aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")

def exists(key):
    try:
        c.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError:
        return False

orphan=exists("$KEY_ORPHAN")
shared=exists("$KEY_SHARED")
soft=exists("$KEY_SOFT")
print(json.dumps({"orphan_exists": orphan, "shared_exists": shared, "soft_exists": soft}))
if orphan:
    raise SystemExit("FAIL: orphan object still in R2 after purge")
if not shared:
    raise SystemExit("FAIL: shared object was deleted while still referenced")
# soft key not purged (row still soft-deleted in bin, not hard-purged) — should still exist
if not soft:
    raise SystemExit("FAIL: soft-delete fixture object missing unexpectedly")
print("PASS r2_purge_orphan_deleted_shared_retained")
PY

# Cleanup: hard-delete remaining fixture rows + enqueue soft key + drain
psql_stg -c "
begin;
select set_config('request.jwt.claims', json_build_object('sub', '$ADMIN_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
-- soft-delete keep_b then purge both remaining
update public.one_liners set deleted_at=now(), purge_after=now()+interval '30 days' where id='$KEEP_B'::uuid and deleted_at is null;
select public.purge_content('one_liner', '$KEEP_B'::uuid);
select public.purge_content('one_liner', '$SOFT_ID'::uuid);
commit;
"
bash -lc 'set -a; source /etc/medverse-staging/nextjs.env; set +a; export MEDVERSE_DATABASE=medverse_staging R2_PURGE_LIMIT=50; bash /opt/medverse-staging/current/deploy/scripts/r2-purge-once.sh' || true

# Final existence — all fixture keys should be gone
python3 - <<PY
import boto3
from botocore.exceptions import ClientError
env={}
with open("/etc/medverse-staging/nextjs.env") as f:
    for line in f:
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v=line.split("=",1); env[k]=v.strip().strip('"').strip("'")
bucket=env.get("R2_PAYMENT_BUCKET") or env.get("R2_BUCKET")
c=boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
  aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
left=[]
for key in ("$KEY_ORPHAN","$KEY_SHARED","$KEY_SOFT"):
    try:
        c.head_object(Bucket=bucket, Key=key); left.append(key)
    except ClientError:
        pass
print("REMAINING_FIXTURE_KEYS="+str(len(left)))
if left:
    # best-effort delete leftovers
    for k in left:
        try: c.delete_object(Bucket=bucket, Key=k)
        except Exception: pass
    print("CLEANED_LEFTOVERS")
else:
    print("PASS fixture_r2_cleaned")
PY

PROD_AFTER="$(readlink -f /opt/medverse/current)"
[[ "$PROD_BEFORE" == "$PROD_AFTER" ]] || die "production current changed"
PROD_R2=$(sudo -n -u postgres psql -d medverse -Atqc "select count(*) from information_schema.columns where table_schema='public' and table_name='one_liners' and column_name='r2_object_key'")
[[ "$PROD_R2" == "0" ]] || die "production gained r2 column"
echo "PROD_UNTOUCHED=yes"
echo "ALL_POST_VERIFY_OK"
