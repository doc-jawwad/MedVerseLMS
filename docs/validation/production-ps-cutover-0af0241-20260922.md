# Production Release Sign-Off — Prof. Session Cutover
## App `0af0241` + DB `20260922000007`

**Date:** 2026-09-22 / 2026-09-23 (UTC)  
**Authorization:** Explicit operator authorization — PRODUCTION PROF. SESSION CUTOVER  
**Branch:** `integration/medverse-final`  
**App commit (exact tested):** `0af0241ad7caede90555ac7a8f0c291d98727fc7`  
**Migration/data-prep commit (intended):** `e0c7e67` (+ CHECK-order fix `d69190a`)

---

## Rollback Target

`/opt/medverse/releases/20260922T055336Z-43b1784-anon-jwt-rebuild`  
(Verified present. Note: cutover brief cited `20260920T055336Z-…`; actual prior anon-JWT rebuild is **`20260922T055336Z-…`**.)

---

## Production Release Directory

`/opt/medverse/releases/20260922T145757Z-0af0241-ps-cutover`  
Symlink: `/opt/medverse/current` → this release  
`RELEASE_COMMIT` = `0af0241ad7caede90555ac7a8f0c291d98727fc7`

---

## Pre-Deployment Backup

| Field | Value |
|-------|--------|
| Tag | `pre-ps-005` |
| Object | `medverse/production/pre-ps-005/20260922T145045Z.dump.enc` |
| Size | `2595648` bytes (local/remote match verified at cutover) |
| Mechanism | Established encrypted R2 backup (`backup-to-r2.sh` / `MEDVERSE_BACKUP_CONFIRM`) |

Pre-migration DB head at backup time: **`20260922000004`**

---

## DB Migration Delta Applied

| # | Migration | Status |
|---|-----------|--------|
| 1 | `20260922000005_prof_session_subject_ia.sql` | APPLIED |
| 2 | `20260922000006_prof_session_day_practice_batch.sql` | APPLIED |
| 3 | `20260922000007_prof_session_day_practice_year_scope.sql` | APPLIED |

**Pre-deploy DB head:** `20260922000004`  
**Post-deploy DB head:** `20260922000007` ✓

---

## Exact Production Data Effect

### Final-Year product subjects
After corrective ensure (see Deviations):

| Name | product_key |
|------|-------------|
| Medicine | `medicine` |
| Surgery | `surgery` |
| Gynecology & Obstetrics | `gynecology` (name preserved; key already present) |
| Pediatrics | `pediatrics` |

Also present (non-product): `Surgery II` with `product_key` null (pre-existing; unchanged).

### Prof. Session days
| id | name | subject_id | status | deleted |
|----|------|------------|--------|---------|
| `7caa8e9d-…` | Day 1 | null | draft | yes (pre-existing) |
| `e703ca62-…` | Day 1 | null | published | yes (**soft-deleted by 005**; not mapped) |
| `0e958763-…` | Day 1 | Gynecology | draft | yes (Bin) |
| `8a40cd57-…` | SMOKE-CUTOVER Day | Medicine | draft | yes (smoke create then Bin) |

**Live days after cutover:** 0  
**Live unmapped days:** 0  
**Blocks 1–12:** all 12 `block-*` product keys present

### RPC signatures
`admin_create_prof_session_day(p_subject_id uuid, p_name text, p_sort_order integer)` — subject-scoped ✓

---

## Services / Health

| Check | Result |
|-------|--------|
| `medverse-next.service` | active |
| `medverse-postgrest.service` | active |
| `caddy.service` | active |
| `https://lms.medversepk.com/api/health` | **HTTP 200** `{"ok":true,"service":"medverse-lms"}` |
| PostgREST `http://127.0.0.1:3001/` | **HTTP 200** |
| `SUPABASE_DIRECT_URL` | `https://pxoxijlhcvbrostrquft.supabase.co` ✓ |
| Staging URL in prod env | absent ✓ |

---

## Authenticated Smoke (MANUAL)

### Student (`chat1gpt00@gmail.com`, Final Year MBBS)
| Surface | Result |
|---------|--------|
| Login | PASS |
| Dashboard | PASS (class Final Year MBBS; subject tiles present) |
| Academic | PASS (current class only: Medicine / Surgery / Gynecology / Pediatrics) |
| Prof. Session | PASS (`/academic/prof-session`; four FY subjects; no published days) |
| Subscription | PASS |
| Tests | PASS |
| OSPE Practice | PASS |
| Profile | PASS (class locked Final Year) |

Note: `mvuat305008@uberip.com` has **duplicate profile rows** (Auth UID vs enrolled profile mismatch) — pre-existing; not used for smoke.

### Admin (`medversepakistan@gmail.com`, Main Admin)
| Surface | Result |
|---------|--------|
| Login | PASS |
| Prof. Session admin | PASS |
| Final-Year subjects | PASS (Medicine / Surgery / Gynecology & Obstetrics / Pediatrics) |
| Create day under Medicine | PASS (`SMOKE-CUTOVER Day`, draft) |
| Day slots | PASS: Guidelines · LoS · Practice MCQs · Test MCQs · One-Liners |
| Cleanup | Smoke day moved to Bin (non-destructive soft-delete) |

**Auth note:** Ephemeral Auth Admin password rotation was used for smoke on the two accounts above. Operators must reset those passwords via normal recovery.

---

## Staging Safety

| Item | Value |
|------|--------|
| Staging DB head | `20260922000007` (unchanged by this cutover) |
| Staging app | `0af0241ad7ca…` at `/opt/medverse-staging/releases/20260922T141355Z-0af0241-ps-complete` |
| Staging modified during cutover? | **No** |

Cloud Supabase Postgres/schema: **not touched**.

---

## Deviations

### DEV-PS-001 — Migration 005 applied from `0af0241` tree lacked FY ensure §0

**What happened:**  
Release trees built from app commit `0af0241` contain `20260922000005_…sql` **without** the Final-Year product-subject ensure introduced in `e0c7e67` (`ensure=False` in release + `/tmp` apply copies). Migrations `005–007` were applied from that tree. Schema/RPC cutover succeeded, but `medicine` / `surgery` product_keys were **not** attached (existing name rows remained `product_key` null). `pediatrics` was already keyed; `gynecology` already keyed on `Gynecology & Obstetrics`.

**Correction (same change window):**  
Re-ran idempotent ensure §0 SQL from `e0c7e67` against production (`UPDATE 2` Medicine+Surgery; `INSERT 0`). Post-fix product keys: `gynecology,medicine,pediatrics,surgery`.

**Follow-up:** Future cutovers that combine “app at SHA A + migrations from SHA B” must apply migration files from SHA B explicitly, not from the app release tree.

### DEV-PS-002 — Rollback path timestamp

Authorized brief listed `20260920T055336Z-43b1784-anon-jwt-rebuild`. Actual retained rollback directory is `20260922T055336Z-43b1784-anon-jwt-rebuild`.

### DEV-PS-003 — Mid-apply 005 CHECK ordering (prior in cutover)

First apply of 005 failed inserting `los` before CHECK drop; fixed by `d69190a` order and re-applied idempotently (recorded in cutover session). Final head `20260922000007`.

---

## Final Status

**PRODUCTION DEPLOYED — Prof. Session cutover complete** (with DEV-PS-001 corrective ensure applied).

This record does **not** by itself authorize further production changes.

---

*Append-only. Do not modify after signing.*  
*Staging phase sign-offs do NOT authorize production deployment.*
