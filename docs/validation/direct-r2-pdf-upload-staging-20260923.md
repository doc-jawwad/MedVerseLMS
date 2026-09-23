# Direct-to-R2 PDF upload — staging (2026-09-23)

**Scope:** Staging only (`staging.medversepk.com`). Production untouched.

**App release:** `826d83401e42c5efef1acdbff12145554c3f3500`  
**Staging path:** `/opt/medverse-staging/releases/20260923T053905Z-826d834-direct-r2`  
**Prod release (unchanged):** `0af0241` / DB `20260922000007`  
**Schema migration:** none

## Architecture

Browser → authenticated Server Actions (`begin` / `signParts` / `complete` / `abort`) → R2 multipart or single PUT (presigned) → server HEAD + 8-byte `%PDF-` range verify → `materials` insert.

HMAC upload session (no new table). Object key from `allocate_study_object_key` only.

| Mode | Threshold | Part size |
|------|-----------|-----------|
| Presigned PUT | `< 32 MiB` | n/a |
| Multipart | `≥ 32 MiB` | 16 MiB (min 8 MiB; ≤9000 parts) |

## Old limits removed

- `STUDY_PDF_MAX_BYTES` (25 MB) — gone
- `serverActions.bodySizeLimit` / `proxyClientMaxBodySize` PDF workarounds (26/28 MB) — reduced to **12mb** for covers/OSPE only

## R2 CORS — ACTION REQUIRED

Bucket `medverse-staging-private` currently returns: **`CORS not configured for this bucket`**.

The app R2 access key cannot `PutBucketCors` (AccessDenied).

Apply in Cloudflare Dashboard → R2 → `medverse-staging-private` → Settings → CORS (policy in `src/lib/r2/cors-policy.ts`):

- Origins: `https://staging.medversepk.com`, `https://lms.medversepk.com`
- Methods: `GET`, `PUT`, `HEAD`
- Headers: `Content-Type`, `Content-Length`, `x-amz-content-sha256`, `x-amz-date`, `Authorization`
- Expose: `ETag`, `Content-Length`, `Content-Type`
- MaxAge: 3600

Also recommend AbortIncompleteMultipartUpload lifecycle: prefix `study-content/`, 7 days.

Until CORS is applied, **browser** direct uploads will fail preflight. Server-side R2 smoke (below) already proves multipart/signing/size path.

## Verified R2 smoke (VPS Node → R2, not through Next)

| Size | Mode | Result | Heap delta | Max RSS |
|------|------|--------|------------|---------|
| 5 MB | PUT | OK | ~4 MB | ~94 MB |
| 25 MB | PUT | OK | ~3 MB | ~163 MB |
| 50 MB | MPU | OK | ~4 MB | ~210 MB |
| 100 MB | MPU | OK | ~2 MB | ~275 MB |
| **200 MB** | MPU | **OK** | ~3 MB | ~291 MB |
| 500 MB | MPU | OK | ~2 MB | ~324 MB |
| **1 GB** | MPU | **OK** | ~3 MB | ~324 MB |

1 GB elapsed ~98s; Node heap stayed ~7 MB (no full-file buffer).

## Commits

1. `ea091a3` — Upload study PDFs direct to R2 via multipart, remove 25MB app limit  
2. `aa3b7e6` — Fix R2 SigV4 header casing for Range  
3. `826d834` — Fix R2 UploadPart SigV4 query sort (byte order, not locale)

## Production

Untouched (symlink + DB head verified on each staging deploy).
