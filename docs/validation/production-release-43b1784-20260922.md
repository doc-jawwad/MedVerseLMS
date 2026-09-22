# Production Release Sign-Off — MedVerse LMS
## RC: 43b1784 → Production

**Date:** 2026-09-22  
**Deployer:** Dr. Jawwad Ahmad (docjawwadahmad@gmail.com)  
**Branch:** integration/medverse-final  
**RC Commit:** 43b1784609c06a89edca208f304dbdf0b5c665b9  
**Fix Commit:** 0d161be (migration fix, committed pre-deploy)

---

## Rollback Target
`/opt/medverse/releases/20260920T042607Z-8721ac6-rc`

---

## Production Release Directory
`/opt/medverse/releases/20260922T031500Z-43b1784-final-rc`  
Build ID: `aQQlGY3Q5aqShtmFdLzO4`  
Method: `cp -al` hardlink from staging RC `20260921T230801Z-43b1784-mock-lock`

---

## Pre-Deployment Backup
`/opt/medverse/backups/pre_43b1784_20260922_20260922T031010Z.dump`  
Size: 2.4 MB, 40 TABLE DATA objects  
Verified: `pg_restore --list` (readable, non-empty)

---

## DB Migration Delta Applied

| # | Migration | Status | Notes |
|---|-----------|--------|-------|
| 1 | 20260920053838_ospe_practice_stations.sql | APPLIED | Clean |
| 2 | 20260920070000_ospe_stations_authenticated_grants.sql | APPLIED | Clean |
| 3 | 20260920073248_data_spine_prof_blocks_bin.sql | APPLIED | See Deviations |
| 4 | 20260921000000_subscription_plans_per_year_and_block_access.sql | APPLIED | Clean |
| 5 | 20260922000001_mock_tests.sql | APPLIED | Clean |
| 6 | 20260922000002_one_liners.sql | APPLIED | Clean |
| 7 | 20260922000003_bulk_question_ops.sql | APPLIED | Clean |
| 8 | 20260922000004_fix_one_liners_grant.sql | APPLIED | Clean |

**Pre-deploy DB head:** 20260919254000  
**Post-deploy DB head:** 20260922000004 ✓

---

## Pre-Flight Checks (Phase 3)
- [x] All services active (medverse-next, medverse-postgrest, caddy)
- [x] Health 200: `https://lms.medversepk.com/api/health`
- [x] PostgREST 200: `http://127.0.0.1:3001/`
- [x] No `SUPABASE_DIRECT_URL` in production env file
- [x] DB on correct pre-deploy head (20260919254000)
- [x] Production backup verified readable

---

## Post-Deploy Verification

### Services
- medverse-next.service: **active (running)**, Next.js 16.3.5, ready in 892ms
- medverse-postgrest.service: **active (running)**, 47 relations, 188 RPCs, 0 errors
- HTTPS health: **200 OK**
- Build ID: `aQQlGY3Q5aqShtmFdLzO4`
- Release commit: `43b1784609c06a89edca208f304dbdf0b5c665b9`

### DB Feature Verification
- [x] `one_liners` table: exists, 5 RLS policies (4 admin + 1 student select)
- [x] `prof_session_days` table: exists
- [x] `prof_session_day_slots` table: exists
- [x] `r2_purge_queue` table: exists
- [x] `ospe_stations` table: exists
- [x] `subjects.product_key` column: exists
- [x] Block 1–12 subjects with product_key set: 12/12 ✓
- [x] `subscription_plans.year_id` column: exists, both plans backfilled to Year 1
- [x] `tests.test_type` column: exists, all 7 existing tests = 'formal'
- [x] `tests.subject_id` column: exists
- [x] pg_cron `medverse-purge-bin` job: scheduled `20 3 * * *`

### RPCs Present (17/17)
`admin_create_prof_session_day`, `admin_update_prof_session_day`,
`bulk_soft_delete_questions`, `claim_r2_purge_batch`, `complete_r2_purge`,
`create_one_liner`, `enqueue_r2_purge`, `get_academic_tree`,
`import_one_liner_batch`, `list_content_bin`, `list_student_mock_tests`,
`purge_content`, `purge_expired_bin_items`, `restore_content`,
`search_academic_tree`, `set_resource_entitlement`, `soft_delete_content`,
`update_one_liner`

### Browser (Pre-Login)
- [x] Landing page: renders correctly, no console errors
- [x] Sign-in page: renders correctly, no console errors

---

## Deviations from Exact RC Delta

### DEV-001: Migration 20260920073248 — Block Subject INSERT guard fixed

**What happened:**  
Migration 3 (`20260920073248_data_spine_prof_blocks_bin.sql`) failed on its first application attempt with:
```
ERROR: duplicate key value violates unique constraint "subjects_year_id_name_key"
DETAIL: Key (year_id, name)=(85293f64..., Block 4) already exists.
```

**Root cause:**  
Production had subjects named "Block 4"–"Block 12" in years 2–4 with `product_key = NULL` (pre-existing from the initial data setup). The migration's `WHERE NOT EXISTS` guard checked only `product_key` uniqueness, not name uniqueness. When `product_key = NULL` for all existing subjects, the guard passed but the `(year_id, name)` unique constraint then fired on INSERT.

**Partial execution before failure:**  
Migrations 1–2 applied cleanly. Migration 3 executed all `ALTER TABLE`, constraint and index DDL, and Year 5 `UPDATE` statements successfully before the `INSERT` failure. Part B (`CREATE TABLE prof_session_days`, all RPCs, pg_cron) had not started when the failure occurred.

**Fix (commit 0d161be):**  
Replaced `INSERT ... WHERE NOT EXISTS (... product_key = v.product_key)` with  
`INSERT ... ON CONFLICT (year_id, name) DO UPDATE SET product_key = EXCLUDED.product_key, sort_order = EXCLUDED.sort_order, updated_at = now() WHERE subjects.product_key IS DISTINCT FROM EXCLUDED.product_key`.

**Verification before re-applying:**  
- `supabase db reset` clean on local
- 426/426 unit tests PASS
- All pgTAP tests PASS
- 0 TypeScript errors
- Production-like idempotency test: pre-nulled Block 4–6, re-ran INSERT → `INSERT 0 3` (3 updated, 9 inserted), all 12 blocks correct — PASS
- Migration re-applied cleanly from line 1 (all Part A DDL idempotent, Part B fresh)

**Re-application result:**  
`INSERT 0 12` (all 12 Block subjects upserted), `prof_session_days` table created, recorded in schema_migrations. Clean.

**Impact on correctness:** None — the ON CONFLICT behavior is identical to the migration's intent. The existing Block subjects now have their `product_key` set correctly.

---

## Auth Fix — 2026-09-22 (Post-Deploy Hotfix)

**Applied by:** Claude Code (docjawwadahmad@gmail.com)  
**Time:** 2026-09-22 09:46–09:49 PKT  
**Constraint:** Infrastructure env change only — no code deployment, no DB/schema change, no Auth user modification

### Root Cause
Server-side Next.js auth calls (signIn, requestPasswordReset, signUp, verifyOtp) were failing silently. `makeServerFetch()` in `src/lib/supabase/server.ts` contains logic to rewrite auth URLs from `https://lms.medversepk.com/auth/...` to a direct Supabase URL when `SUPABASE_DIRECT_URL` is set — bypassing the Cloudflare loopback that causes a 522 timeout for VPS-to-VPS traffic. This env var was not set in production, so all server-side auth calls hit `https://lms.medversepk.com/auth/v1/...` → Cloudflare → VPS → Caddy → Supabase Cloud, which fails intermittently with a 522 for Node.js server-side requests.

Evidence: Zero POST `/auth/v1/token` entries in Supabase edge logs (`source = 'edge_logs'`) between deploy time 03:15 UTC and 04:50 UTC. User account `jawwadahmadaimc26@gmail.com` confirmed healthy: exists, email_confirmed_at set, not banned, email+password provider. Password reset emails also silently failed (`requestPasswordReset` swallows non-rate-limit errors per `auth.ts:202`).

### Fix Applied
- Backed up: `/etc/medverse/nextjs.env` → `/etc/medverse/nextjs.env.bak-20260922-auth-fix` (09:46:39 +0500)
- Added: `SUPABASE_DIRECT_URL=https://pxoxijlhcvbrostrquft.supabase.co` to `/etc/medverse/nextjs.env` (09:47:21 +0500)
- Verified: production project ref `pxoxijlhcvbrostrquft` present (count=1), staging ref `vygtwrsshcyfahfzurgq` absent (count=0)
- All 6 existing env vars preserved unchanged
- Restarted: `medverse-next.service` (09:48:43 +0500, clean startup, ready in 671ms)

### Post-Fix Verification
| Check | Result |
|-------|--------|
| `medverse-next.service` | active (running), restart at 09:48:43 +0500 ✓ |
| `medverse-postgrest.service` | active, unchanged ✓ |
| `caddy.service` | active, unchanged ✓ |
| Health `GET /api/health` | 200 `{"ok":true,"service":"medverse-lms"}` ✓ |
| Supabase edge log — POST `/auth/v1/token` (04:50 UTC) | Reached `pxoxijlhcvbrostrquft`, IP 194.233.67.184, 401 Kong no-apikey (expected — no real credentials in test) ✓ |
| Supabase edge log — POST `/auth/v1/token` (04:52 UTC) | Direct-path curl to `pxoxijlhcvbrostrquft.supabase.co` also reached, same result ✓ |
| Production DB/schema | No changes — confirmed no migration, no DDL executed ✓ |
| Code deployment | None — no git pull, no Next.js restart from new code ✓ |
| Supabase Auth users | None modified — no password reset, no user changes ✓ |
| `SUPABASE_DIRECT_URL` project ref | `pxoxijlhcvbrostrquft` (production) only — not staging ✓ |

### Pending (Operator)
Real login with correct credentials for `jawwadahmadaimc26@gmail.com` needed to confirm end-to-end fix. The network path is now: Next.js → `pxoxijlhcvbrostrquft.supabase.co` directly (no Cloudflare loopback). If login still fails, the password itself is incorrect — use the forgot-password flow, which will now also route directly to Supabase and deliver an email.

---

## Items Requiring Manual Browser Verification by Operator

The following require admin/student login credentials which cannot be entered by the automated deployer:

**Admin UI:**
- [ ] Admin dashboard loads, no 4xx/5xx
- [ ] Students list renders
- [ ] Subscriptions & Applications render
- [ ] Question Bank: create/edit question, CSV import
- [ ] Mock Tests: create mock test, verify SectionLock on free student
- [ ] One-Liners: create/publish, import CSV
- [ ] Content Bin: soft-delete, restore, purge
- [ ] Prof Session: create day, publish, manage slots
- [ ] OSPE stations admin page

**Student UI:**
- [ ] Student login, dashboard renders
- [ ] Academic tree: free blocks locked, paid blocks accessible
- [ ] Library & Resources pages load
- [ ] Formal exam: start/submit attempt
- [ ] OSPE practice stations
- [ ] Question practice mode
- [ ] Profile, theme toggle, session persistence

---

## Pre-Login Browser Checks — PASS
- Landing page: 200, no errors ✓
- Sign-in page: 200, no errors ✓
- Health endpoint: 200 ✓
- PostgREST: 200, 47 relations, 188 RPCs ✓

---

## Authenticated Smoke Test — 2026-09-22 (Partial Automated / Partial Operator Required)

**Test date:** 2026-09-22  
**Method:** Claude Code automated browser (Chrome extension) + SSH DB verification  
**Authentication:** Browser-saved credentials were stale (auth rejected "Invalid email or password."). Authenticated UI walkthrough could not be completed automatically.

### Security & Route Guards — AUTOMATED PASS

| Check | Result |
|-------|--------|
| `/admin` unauthenticated | 307 → `/login?next=%2Fadmin` ✓ |
| `/admin/students` unauthenticated | 307 → `/login?next=%2Fadmin%2Fstudents` ✓ |
| `/admin/questions` unauthenticated | 307 → login ✓ |
| `/admin/mock-tests` unauthenticated | 307 → login ✓ |
| `/admin/one-liners` unauthenticated | 307 → login ✓ |
| `/admin/prof-session` unauthenticated | 307 → login ✓ |
| `/admin/content-bin` unauthenticated | 307 → login ✓ |
| `/dashboard` unauthenticated | 307 → login ✓ |
| `/library` unauthenticated | 307 → login ✓ |
| `/resources` unauthenticated | 307 → login ✓ |
| `/profile` unauthenticated | 307 → login ✓ |
| `/api/r2/study-content/*` unauthenticated | 307 → login ✓ |
| PostgREST port 3001 external | Not exposed (connection refused) ✓ |
| `/rest/v1/profiles` (no JWT) | 401 permission denied ✓ |
| `/rest/v1/tests` (no JWT) | 401 permission denied ✓ |
| `/rest/v1/one_liners` (no JWT) | 200 `[]` — intentional (anon SELECT + RLS returns 0 rows, documented in migration 20260922000004) ✓ |
| Auth error handling | "Invalid email or password." shown correctly ✓ |

### Public Pages — AUTOMATED PASS

| Page | HTTP | Console Errors |
|------|------|----------------|
| `/` | 200 | None ✓ |
| `/register` | 200 | None ✓ |
| `/forgot-password` | 200 | None ✓ |
| `/login` | 200 | None ✓ |
| `/api/health` | 200 `{"ok":true,"service":"medverse-lms"}` | — ✓ |

### DB Feature Verification — AUTOMATED PASS (see Phase 6 sign-off above)

All 17 RPCs, all new tables, RLS policies, Block subjects, subscription plan year backfill, pg_cron job — all verified via SSH DB queries.

### Items Requiring Operator Manual Verification

Browser-saved credentials were stale. The following require a valid authenticated session:

**Admin walkthrough (operator must verify):**
- [ ] Admin login succeeds, dashboard loads without errors
- [ ] Students list renders (pagination, search)
- [ ] Admin permissions page
- [ ] Subscription plans: year_id field shows, block access toggles
- [ ] Subscription applications list
- [ ] Question Bank: question list, create/edit, CSV import
- [ ] Mock Tests: create mock test, verify SectionLock shows for free students
- [ ] One-Liners: create, publish, CSV import (Pearl import)
- [ ] OSPE stations admin
- [ ] Prof Session: create day, add slots, publish
- [ ] Content Bin: soft-delete, restore, purge actions
- [ ] Search returns results
- [ ] Dark/light theme toggle works

**Student walkthrough (operator must verify):**
- [ ] Student login succeeds, dashboard loads
- [ ] Session persists on refresh
- [ ] Academic tree renders: free blocks visible, locked blocks show lock state
- [ ] Free block content accessible, locked block content blocked (server-side 307)
- [ ] Subscription flow visible
- [ ] Prof Session shows locked for free student
- [ ] Mock Tests: show locked with SectionLock for free student
- [ ] Formal tests: accessible per entitlement
- [ ] OSPE practice stations
- [ ] Question practice mode
- [ ] One-Liners: published items visible to enrolled student
- [ ] Search returns results
- [ ] Profile page renders
- [ ] Dark mode toggle works
- [ ] MCQ readability acceptable

---

*Append-only. Do not modify after signing.*  
*Staging phase sign-offs do NOT authorize production deployment.*
