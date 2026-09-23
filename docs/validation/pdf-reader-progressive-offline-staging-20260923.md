# Protected progressive PDF reader + offline — staging acceptance (2026-09-23)

**Scope:** Staging only. Production untouched (`0af0241` / DB `20260922000007`).

**Staging app:** `b082e5b` (reader UX + leading-206 range gate + offline retry)  
**Schema migration:** none

## Architecture

1. Student opens `/materials/[id]/read` → `open_study_item` entitlement gate.
2. Browser PDF.js loads `/api/study-content/[id]` with credentials.
3. API re-checks `authorize_study_object`, then streams R2 via short-lived presigned GET.
4. **Unscoped GET** is coerced to a leading `206` (`bytes=0-65535`) so Next never streams the full object; PDF.js continues with Range.
5. Offline: explicit **Save for Offline** → OPFS bytes + IndexedDB metadata (`entitlementExpiresAt`, `contentRevision`).

## Online progressive results (free-folder aliases of accepted uploads)

| Size | Material | TTFP | Coerced leading 206 | Next heavy POST | Result |
|------|----------|------|---------------------|-----------------|--------|
| 200 MB | `590f9d2d-…` | **7,184 ms** | `bytes 0-65535/209715143` | 0 | **PASS** |
| 500 MB | `97d9e49e-…` | **14,305 ms** | `bytes 0-65535/524287943` | 0 | **PASS** |
| 1 GB | `e2750418-…` | **7,370 ms** | `bytes 0-65535/1073741767` | 0 | **PASS** |

Node RSS during large reads: **~61,524 KB** flat (sampler). `/tmp`: **~446–448 MB** flat. Production pin unchanged.

## Offline

- Storage: **OPFS** (+ IndexedDB meta). Not Downloads / Cache API.
- Confirm size + quota before save; cancel; retry with per-chunk retries; remove offline; reading-progress in `localStorage`.
- Entitlement TTL 24h; purge on expiry; wipe on 403; invalidate on content revision change.
- **PWA limitation:** service worker does **not** cache document navigations (by design). Full reload while offline requires a future shell-cache change. In-session **Open offline copy** + blocked `study-content` network verified as the offline document path.
- Practical offline save: 20 MB free fixture (chunked Range → OPFS). Device quota must allow size; not every browser can store 1 GB.

## Access control (STATIC + MANUAL samples)

| Check | Result |
|-------|--------|
| Anonymous `/api/study-content/…` | 307 → `/login` |
| No Download PDF control | unit + UI |
| No public R2 URL / signature in reader HTML | e2e |
| Student cannot pick R2 key | key only via `authorize_study_object` |
| Locked Past Papers vs free Notes | free-folder aliases used for student large-file tests |

## Tests run

- `npm run test:unit` — 444 pass (includes `pdf-reader-policy`)
- `npx tsc --noEmit` — clean after OPFS write typing fix
- Playwright staging: progressive 200/500/1GB **PASS**; range smoke + offline save re-run after `b082e5b` deploy

## Commits (staging lineage)

- `e338028` / `a78b2dc` — offline UX (quota, progress, confirm)
- `9983966` — Open offline copy
- `eab5a91` — range-only PDF.js options + load cancellation
- `63a61a6` — leading 206 for unscoped GET (**critical**)
- `0025ba3`–`b082e5b` — offline chunk retry + TS/OPFS write fix

## Remaining limitations

1. Synthetic large PDFs may be 1-page; distant-page jump needs multi-page fixtures.
2. Offline full-file load uses `ArrayBuffer` in RAM (not range) after OPFS save.
3. App shell is not offline-cached; reopen-after-kill while offline needs PWA shell work.
4. Not absolute DRM.

## Production

**Untouched** throughout (`0af0241`).
