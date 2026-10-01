#!/usr/bin/env python3
"""VPS R2 purge queue worker. claim/complete via psql; delete via boto3. NO prefix wipes."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

DB = os.environ.get("MEDVERSE_DATABASE", "medverse")
LIMIT = max(1, min(int(os.environ.get("R2_PURGE_LIMIT", "50")), 200))
BUCKET = (os.environ.get("R2_BUCKET_EFFECTIVE") or os.environ.get("R2_PAYMENT_BUCKET") or os.environ.get("R2_BUCKET") or "").strip()
ACCOUNT = (os.environ.get("R2_ACCOUNT_ID") or "").strip()
AK = (os.environ.get("R2_ACCESS_KEY_ID") or "").strip()
SK = (os.environ.get("R2_SECRET_ACCESS_KEY") or "").strip()
ENDPOINT = (os.environ.get("R2_ENDPOINT") or "").strip() or f"https://{ACCOUNT}.r2.cloudflarestorage.com"


def psql(sql: str) -> str:
    return subprocess.check_output(
        [
            "sudo",
            "-n",
            "-u",
            "postgres",
            "psql",
            "-d",
            DB,
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-F",
            "\t",
            "-c",
            sql,
        ],
        text=True,
    )


def claim_batch(limit: int) -> list[dict[str, Any]]:
    # claim_r2_purge_batch increments attempts under FOR UPDATE SKIP LOCKED
    out = psql(
        f"""
SELECT id::text, object_key, coalesce(entity_type,''), coalesce(entity_id::text,''), attempts
FROM public.claim_r2_purge_batch({limit});
"""
    ).strip()
    rows: list[dict[str, Any]] = []
    if not out:
        return rows
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        rows.append(
            {
                "id": parts[0],
                "object_key": parts[1],
                "entity_type": parts[2] or None,
                "entity_id": parts[3] or None,
                "attempts": int(parts[4]),
            }
        )
    return rows


def complete(row_id: str, error: str | None = None) -> None:
    if error:
        err = error.replace("'", "''")[:2000]
        psql(f"SELECT public.complete_r2_purge('{row_id}'::uuid, '{err}');")
    else:
        psql(f"SELECT public.complete_r2_purge('{row_id}'::uuid, null);")


def still_referenced(object_key: str) -> bool:
    key = object_key.replace("'", "''")
    out = psql(
        f"""
SELECT EXISTS (
  SELECT 1 FROM public.materials m
  WHERE m.r2_object_key = '{key}' OR m.cover_object_key = '{key}'
  UNION ALL
  SELECT 1 FROM public.ospe_stations o WHERE o.r2_object_key = '{key}'
  UNION ALL
  SELECT 1 FROM public.pearl_points p WHERE p.r2_object_key = '{key}'
  UNION ALL
  SELECT 1 FROM public.profiles pr WHERE pr.avatar_object_key = '{key}'
  UNION ALL
  SELECT 1 FROM public.subscription_applications sa
  WHERE sa.screenshot_object_key = '{key}'
);
"""
    ).strip()
    return out == "t"


def safe_key(object_key: str) -> str | None:
    if not object_key or "://" in object_key or ".." in object_key or any(c.isspace() for c in object_key):
        return "invalid_object_key"
    if object_key.startswith("medverse/"):
        return "backup_prefix_forbidden"
    if not (
        object_key.startswith("study-content/")
        or object_key.startswith("payment-proofs/")
    ):
        return "unsupported_object_prefix"
    return None


def delete_object(object_key: str) -> str | None:
    import boto3
    from botocore.exceptions import ClientError

    client = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=AK,
        aws_secret_access_key=SK,
        region_name="auto",
    )
    try:
        client.delete_object(Bucket=BUCKET, Key=object_key)
        return None
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        return f"r2_delete_failed:{code or 'client_error'}"


def main() -> int:
    if not all([BUCKET, ACCOUNT, AK, SK]):
        print("r2-purge-worker: missing R2 config", file=sys.stderr)
        return 1
    if DB == "medverse_staging" and "prod" in BUCKET:
        print("r2-purge-worker: refusing prod bucket on staging DB", file=sys.stderr)
        return 2
    if DB == "medverse" and "staging" in BUCKET:
        print("r2-purge-worker: refusing staging bucket on prod DB", file=sys.stderr)
        return 2

    claimed = claim_batch(LIMIT)
    results = []
    for row in claimed:
        key = row["object_key"]
        key_err = safe_key(key)
        if key_err:
            complete(row["id"], key_err)
            results.append({"id": row["id"], "object_key": key, "outcome": "failed", "error": key_err})
            continue
        try:
            if still_referenced(key):
                complete(row["id"], None)
                results.append(
                    {
                        "id": row["id"],
                        "object_key": key,
                        "outcome": "skipped_still_referenced",
                    }
                )
                continue
            err = delete_object(key)
            if err:
                complete(row["id"], err)
                results.append(
                    {"id": row["id"], "object_key": key, "outcome": "failed", "error": err}
                )
                continue
            complete(row["id"], None)
            results.append({"id": row["id"], "object_key": key, "outcome": "deleted"})
        except Exception as e:  # noqa: BLE001 — isolate per-row failures
            msg = str(e)[:500]
            complete(row["id"], msg)
            results.append(
                {"id": row["id"], "object_key": key, "outcome": "failed", "error": msg}
            )

    summary = {
        "database": DB,
        "bucket": BUCKET,
        "claimed": len(claimed),
        "deleted": sum(1 for r in results if r["outcome"] == "deleted"),
        "skipped": sum(1 for r in results if r["outcome"] == "skipped_still_referenced"),
        "failed": sum(1 for r in results if r["outcome"] == "failed"),
        "results": results,
    }
    print(json.dumps(summary, indent=2))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
