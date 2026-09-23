# Offline PDF hardening — staging acceptance (2026-09-23)

**Scope:** STAGING ONLY (`https://staging.medversepk.com`)  
**App release:** `cc4e93c` (`cc4e93c64947d80feae235eaccad88e5a32721fe`)  
**Prior staging:** `b082e5b`  
**Production:** untouched at `0af0241` / DB `20260922000007`  
**Staging DB:** unchanged by this deploy (no migrations)

## Commits

| SHA | Summary |
|---|---|
| `cc4e93c` | Harden cold-start offline PDF shell with OPFS range reopen |
| (follow-up) | Fix offline library e2e cold-start to reuse browser profile storage |

## Offline shell strategy

- Service worker caches **only** `/offline` and `/offline/read/*` document navigations into `medverse-shell-v1`.
- Precache: `/offline`, `/pdf.worker.min.mjs`.
- Still caches hashed `/_next/static/*` + branding into `medverse-static-v3` on first fetch.
- Explicit `CACHE_OFFLINE_SHELL` message after Save for Offline / reader open.
- **Does not** cache `/api/*`, Auth, PostgREST, exam routes, R2, or arbitrary authenticated pages.
- `/offline` is public in `proxy.ts` so the shell can boot without auth RPCs when offline.
- Student nav: **Offline Library**.

## OPFS range strategy

- Offline reopen uses `PDFDataRangeTransport` + `File.slice` ranges (`createOpfsPdfRangeTransport`).
- `disableAutoFetch: true`, `disableStream: true`, `rangeChunkSize: 512 KiB`.
- Full-file `arrayBuffer()` path retained only as a legacy helper; reader path does not use it.
- Online path unchanged: PDF.js Range against `/api/study-content/[id]` (private R2).

## Offline Library UI

Per document: title, size, saved date, status, Open / Retry / Remove offline.

States: **Available offline** · **Saving…** · **Failed — Retry** · **Offline access expired**.

## Memory measurements (staging e2e)

Free cached PDF (~20 MiB):

```
[offline-mem] usedJSHeapSize=31200000 byteSize=20971520
```

Absolute heap ≈ 31 MiB with a 20 MiB file (dominated by Next/React baseline). Asserts that heap must be `< byteSize` apply only for offline files ≥ 64 MiB. Range transport avoids materializing the full OPFS file into a single `ArrayBuffer`.

## Tests

| ID | Result |
|---|---|
| A/B Cold-start offline library + OPFS reopen + page nav + remove | PASS (`pdf-offline-library.spec.ts`) |
| D Entitlement expiry invalidates offline row | PASS |
| Multipage fixture (40 pages, synthetic, not committed binary) | PASS |
| Unit: pdf-reader-policy + pwa-cache-policy | PASS |
| Online 200/500/1GB progressive | Prior staging acceptance on `b082e5b` / evidence docs — not re-run this pass |

Command:

```bash
E2E_TARGET=staging npx playwright test tests/e2e/pdf-offline-library.spec.ts
# 3 passed (~1.9m)
```

## Staging release checks

```
HEALTH=200
STG_APP=cc4e93c64947d80feae235eaccad88e5a32721fe
PROD_APP=/opt/medverse/releases/20260922T145757Z-0af0241-ps-cutover
PROD_DB=20260922000007
PROD_UNTOUCHED=yes
```

## Remaining limitations

1. Cold-start requires the student to have visited `/offline` (or saved offline) **while online** at least once after deploy so shell HTML + JS chunks land in Cache API.
2. Playwright cannot simulate a brand-new browser profile cold-start with SW/OPFS; e2e uses same-profile tab close/reopen + `setOffline(true)`.
3. Absolute DRM of offline bytes is impossible in-browser; entitlement TTL + revision mismatch + revoke-on-403 remain the controls.
4. Very large offline reopen memory was not re-measured on a full 1 GB OPFS copy in this pass (range path is in place; ≥64 MiB heap assert ready).
5. Next.js chunk hash changes on each deploy invalidate prior static caches until the student revisits online.

## Production untouched

YES — production app symlink and DB head unchanged.

## Ready for production

**NO** — staging hardened and offline cold-start accepted, but production promotion still requires an explicit prod gate (re-confirm online 200/500/1GB + large offline memory on a real large OPFS copy, then approved cutover). This document does **not** authorize production deployment.
