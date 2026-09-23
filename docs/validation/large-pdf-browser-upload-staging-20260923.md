# Large PDF browser upload acceptance — staging (2026-09-23)

**Scope:** Staging only. Production untouched (`0af0241`).

**App:** `be11b59` (direct-to-R2 multipart uploader)

## Summary

| Size | Result | Material ID | Duration | R2 PartsCount |
|------|--------|-------------|----------|---------------|
| ~200 MB (prior) | **PASS** | `e8d4ab7d-608c-44fb-bbd0-6ae2371cd022` | ~45–60s | 13 |
| **500 MB** | **PASS** | `4ebd7872-d45e-4ddb-a3c7-5df296309513` | **174.7 s** | **32** |
| **1 GB** | **PASS** | `7626c3fa-7986-421c-a067-24fdd4e901bc` | **322.2 s** | **64** |

## 500 MB

| Metric | Value |
|--------|-------|
| Exact bytes | 524,287,943 |
| Upload duration | 174,694 ms |
| Browser R2 PUT count | 32 |
| Next origin >5MB POST | **0** |
| R2 ContentLength | 524,287,943 |
| ContentType | application/pdf |
| AcceptRanges | bytes |
| PartsCount | 32 |
| Node RSS before/during/after | **62,020 KB** flat (90 samples) |
| `/tmp` before/during/after | **357 MB** flat |
| Protected reader page | no public R2 URL / signature |

## 1 GB

| Metric | Value |
|--------|-------|
| Exact bytes | 1,073,741,767 |
| Upload duration | 322,203 ms |
| Browser R2 PUT count | 64 |
| Next origin >5MB POST | **0** |
| R2 ContentLength | 1,073,741,767 |
| ContentType | application/pdf |
| AcceptRanges | bytes |
| PartsCount | 64 |
| Node RSS before/during/after | **62,020 KB** flat (141 samples) |
| `/tmp` before/during/after | **357 MB** flat |
| Multipart complete | yes (object HEAD succeeds) |
| ~1 GB Node memory | **no** |
| ~1 GB VPS temp file | **no** |

## Defects

None in application code. Test harness only: duplicate Midterms placeholder required `.first()` for 1 GB run.

## Production

Untouched throughout.
