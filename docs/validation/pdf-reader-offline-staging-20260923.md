# Protected PDF reader — staging (2026-09-23)

**Scope:** Staging only. Production untouched (`0af0241` / DB `20260922000007`).

**App release:** `be11b592329c01c65a5906cf8b3786d95499c831`  
**Schema migration:** none

## What shipped

- `GET|HEAD /api/study-content/[materialId]` — entitlement via `authorize_study_object`, **streams** R2 with HTTP Range / 206 (no full-object Node buffer).
- In-app **PDF.js** reader: pages, jump, zoom, search, outline, fullscreen, watermark (name · college · MedVerse).
- **No** Download PDF / native toolbar / public R2 URL / credentials to browser.
- **Save for Offline** → origin-private OPFS + IndexedDB metadata + entitlement TTL (24h refresh on online open). Not the Downloads folder; not absolute DRM.

## Evidence

| Check | Level | Result |
|-------|-------|--------|
| Unit policy (no full buffer / no Download) | AUTOMATED `npm run test:unit` | pass |
| R2 range stream smoke (25 MB) | AUTOMATED on VPS | 206 + `%PDF-`, heap Δ ~3 MB |
| Playwright free 20 MB PDF + Range + no R2 leak | AUTOMATED staging | pass (`2607b1b5-…`) |
| Save for Offline / offline reopen | UNVERIFIED this pass | UI present; needs dedicated offline run |
| 200 MB / 1 GB full reader UI | UNVERIFIED | needs valid large PDF in free/paid entitled folder; upload CORS still pending from prior task |

## Commits

- `be11b59` — range-streaming PDF.js reader + offline OPFS
- Prior upload stack remains on staging lineage (`826d834` → `be11b59`)

## Honest limits

Offline-readable bytes necessarily exist on device. Watermark + OPFS + entitlement sync deter casual redistribution; they are not DRM.
