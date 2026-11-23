# Bulk plan — FOLDER-UNLOCK + Student 360 permission mismatch

- **Date:** 2026-11-23 · **Author:** Claude Opus 5.5 (planning only) · **Tracker:** [Issue #11](https://github.com/doc-jawwad/MedVerseLMS/issues/11)
- **Code baseline audited:** `6971567` (PR #16, on live-release lineage `dabebd4`) plus PR #12 `22662b4`. Not production-verified.
- **Scope:** plan only. No application code, migrations, deploys or production reads/writes were made for this plan.
- **Reuse, do not rebuild:** PR #16 (student cache revalidation + admin `router.refresh`), PR #12 (Student 360 contact from Auth metadata).

## 1. Findings — confirmed vs hypothesis

Status key: **CODE** = confirmed by reading source at the baseline; **PROD** = confirmed in production; **HYP** = not yet proven.

| # | Finding | Status |
|---|---|---|
| F1 | Admin save did not refresh student Academic and `/free-resources/[type]` pages, and the admin select did not refresh. | CODE. Fixed in PR #16, not deployed. |
| F2 | **Notes / Syllabus / One Liner / Guidelines / Books / Lectures / OSPE material:** student access is decided per folder only (`accessible_folder_ids[_among]`, `can_access_material_folder` → `resource_content_allowed`). Parent folders and the subject do not lock a Free folder (`get_academic_tree` sets subject `locked:false`; there is no `parent_id` inheritance). So DB behaviour already matches "a Free folder opens for an eligible enrolled student". | CODE |
| F3 | **MCQ Bank access is decided per subject by design.** Docs: [permissions.md](../permissions.md) §Practice ("Main Admin configures each subject/Block as free / subscription / plan"). Student pages `McqBankFoldersPage`, `McqBankFolderDetailPage` and `McqBankSubfolderDetailPage` all gate on `has_practice_access(subject)`. Practice RPCs gate on `can_access_mcq_bank_folder_practice` (subject only). The admin switch that does affect them is **Free Resources → MCQ Bank → subject** (`practice_subject`). | CODE |
| F4 | **Admin control that misleads.** `/admin/materials?type=mcq-bank` lists the MCQ Bank *shadow* `material_folders` rows (`library_type='mcq_bank'`) with an `EntitlementSelect`. Changing it to Free shows "Access updated", but the student MCQ Bank pages ignore it (F3). **This is the most likely cause of the user-reported symptom** if the folder was an MCQ Bank folder. | CODE (exact folder from the report is UNKNOWN) |
| F5 | **Probable paywall leak (more serious than the report).** `ensure_mcq_bank_material_folder` always inserts shadow folders as `entitlement='free'` (comment: "gated by has_practice_access, not folder entitlement"). But `can_access_material_folder`, `accessible_folder_ids` and `accessible_folder_ids_among` check `mcq_bank AND has_practice_access` **OR** `resource_entitlement_allows(entitlement)`. With `free`, the OR is true. Result: any eligible enrolled non-subscriber passes `authorize_study_object` for **paid** MCQ Bank PDFs (direct material id or search). `search_academic_tree_access_surface` uses `accessible_folder_ids()`, so search would also treat those PDFs as accessible. The 82 "Free MCQ Bank folders under paid subjects" in the production audit match this default. They are **not** evidence that an admin unlocked them. | CODE. PROD exploitability UNKNOWN (live function bodies not yet read back). |
| F6 | The Free branch for shadow folders also skips **practice_subject** personal restrictions. A student restricted from subject Y can still open Y's MCQ Bank PDFs. | CODE (follows from F5) |
| F7 | **Prof. Session** is locked as a whole section without a live subscription. Docs: [architecture.md](../architecture.md) §2c; `get_academic_tree` returns `prof_session.locked=true` when there is no live subscription; `authorize_one_liner_object` requires a live subscription. A Free folder inside Prof. Session staying locked for non-subscribers is **intended**. The admin Prof. Session UI shows entitlement read-only (no toggle). | CODE, documented. No change. |
| F8 | `set_resource_entitlement` checks `admin_can_access_year` only for `ospe_station`. An admin with only `manage_materials` and one assigned class can change the entitlement of `materials_folder` / `pearl_point` rows in **other classes**. | CODE (separate from the report, but in the same function as Batch 2) |
| F9 | **Student 360 mismatch.** The page and `student360SectionsForPermissions` admit `view_students`, `manage_students`, `activate_students`, `restrict_students`, `view_analytics`, `manage_subscriptions` and `review_subscription_applications`. But the adapter always calls `admin_student_profile`, which requires `view_students` (docs: [permissions.md](../permissions.md) RPC gates). Any non-`view_students` admin hits an RPC error and sees "Permission denied". | CODE |
| F10 | Student 360 side defects: (a) `account_status` defaults to `"active"` when RLS hides `profiles` (analytics-only), which shows wrong data. (b) `profiles.select("*")` runs for every viewer. (c) `canPayments` includes `manage_payment_settings`, but no RLS policy lets that permission read subscriptions or applications, and the page gate excludes it, so that branch is dead. (d) PR #12 gates its service-role Auth lookup on `visible.includes("biodata")`. Biodata is currently granted to `manage`/`activate`/`restrict_students`, so fixing F9 naively would extend the contact lookup to them. | CODE |

## 2. Intended relationship (decision record)

Derived from canonical docs. Only D1 needs a founder answer.

1. **Material folders (non-MCQ):** the folder's own entitlement is the content boundary. A Free folder under a "paid" subject opens for an eligible student: active account, active enrollment in that year (or universal Career Counseling Series), no personal restriction. No change beyond PR #16.
2. **MCQ Bank:** the subject (`subjects.entitlement`, kind `practice_subject`) is the only boundary for folder listing, PDFs and practice. The shadow folder's `entitlement` column is **not** a student boundary. Explicit per-student folder grants and restrictions still apply.
3. **Prof. Session:** the section-level subscription lock wins over folder Free (architecture §2c).
4. **Unchanged:** account status, enrollment, restrictions, RLS deny-by-default, year scoping and the grace rules.

## 3. Founder decision

- **D1 (essential, blocks Batch 2):** May an admin make **one MCQ Bank folder** Free inside a paid subject?
  - **(a) No, subject-level only. RECOMMENDED.** This matches the docs, is the smallest change, and closes F5.
  - (b) Yes, PDFs only. Practice stays subject-gated.
  - (c) Yes, PDFs and practice. This needs a new folder-level practice entitlement, a doc change first, and a separate plan.
  - Batch 2 below assumes (a). With (b), Batch 2 would instead use a dedicated, admin-set folder flag, never the shadow default. Re-plan only the A-DB step.
- Non-blocking default applied: analytics-only staff see Student 360 **without the student's name or contact**. Name visibility for analytics would need a permissions.md change and is not part of this plan.

## 4. Implementation batches (minimum: one read-only check + two batches)

### Step 0 — production read-only evidence (ChatGPT / operator; no writes; no student identifiers)
Run in one `BEGIN TRANSACTION READ ONLY`:
1. `pg_get_functiondef` for `can_access_material_folder`, `accessible_folder_ids`, `accessible_folder_ids_among`, `set_resource_entitlement` and `admin_student_profile`. Diff them against the repo.
2. Counts only: `mcq_bank` shadow folders by folder entitlement × subject entitlement. Also count active `access_grants` / `access_restrictions` of kind `materials_folder` that point at `mcq_bank` folders. This decides whether grant preservation matters.
3. Aggregates from `audit_logs` for recent `set_resource_entitlement` calls by kind and `library_type`. Return no actor or student IDs. This tells us which folder type the reporting admin actually toggled.

The gate is evidence attached to Issue #11. Nothing else in this plan depends on finding a different root cause. If Step 0 shows a non-MCQ folder that stays locked **after** PR #16, open a narrowly scoped follow-up with the exact folder shape. Do not widen this plan.

### Batch 1 — app-only, R1/R2, no migration
Joins the existing Sonnet app-only integration (PRs #10, #12, #14, #15, **#16**). Stack on PR #16 and PR #12; do not duplicate them.

- **1A FOLDER-UNLOCK UX** (`src/app/(admin)/admin/materials/materials-admin.tsx`, `entitlement-select.tsx` consumer only):
  - On the `mcq_bank` library type, replace `EntitlementSelect` with read-only text: "Access follows subject: Free / Paid".
  - Add a link to `/admin/free-resources?type=mcq-bank`, where the subject (`practice_subject`) switch lives.
  - Do not offer a folder-level Free control for MCQ Bank anywhere in admin.
- **1B Student 360 least privilege** (`src/lib/admin/student-360/{types,adapter}.ts`, `src/app/(admin)/admin/students/[id]/page.tsx`). Each section reads only from sources whose existing RLS already grants that permission. Nothing is widened:

  | Section | Required permission | Data source |
  |---|---|---|
  | Header name / initials | any admitted permission that can read `profiles` under RLS | RPC when `view_students`, otherwise `profiles(full_name)`. For analytics-only: "Student" with no name. |
  | Biodata (email, contact, college, last login, avatar) | **`view_students` only** | `admin_student_profile` + explicit-column `profiles` read + PR #12 Auth contact (`canReadBiodata = view_students`) |
  | Account status + manage actions | `profiles` readable (`manage`/`activate`/`restrict_students`, `view_students`) | `profiles(account_status)`. Never default to "active"; show "—" when unreadable. |
  | Class | `enrollments` readable (`view_students`, `manage_subscriptions`, `grant_resource_access`, `manage_year_changes`) | `enrollments` |
  | Analytics / test history / practice totals | `view_students` or `view_analytics` | `test_attempts` / `practice_answers` (RLS). Compute stats in the adapter when the RPC is not callable. |
  | Practice grants | `view_students` | RPC `subject_access` |
  | Subscription / payment history | `manage_subscriptions` / `review_subscription_applications` | existing tables (year-scoped RLS) |

  - Call `admin_student_profile` **only** when `view_students` is held.
  - Remove `manage_payment_settings` from `canPayments`.
  - Replace `select("*")` with explicit columns, read only when biodata is visible.
  - `admin_student_profile` stays `view_students` (matches permissions.md, so no doc change).

### Batch 2 — DB migration, R2, separate release gate (requires D1 and founder approval for production)
1. **Doc first:** add to [permissions.md](../permissions.md) (material_folders row and §Practice): "`mcq_bank` shadow-folder `entitlement` is not a student access boundary; MCQ Bank PDFs and practice follow `has_practice_access(subject)` plus explicit folder grants and restrictions." Founder approves this together with D1.
2. **One migration** `supabase/migrations/2026112xxxxxxx_mcq_bank_pdf_subject_gate.sql`, written as `create or replace` and set-based. Keep the `(select auth.uid())` initplan style from the recent performance work.
   - In `can_access_material_folder`, `accessible_folder_ids` and `accessible_folder_ids_among`: for `library_type='mcq_bank'`, allow **only** `has_practice_access(subject_id)`, or an explicit non-revoked per-student folder grant (keep this only if Step 0 shows such grants exist). Always apply the folder restriction. **Remove the `resource_entitlement_allows` path for `mcq_bank`.** Non-MCQ folders keep the current logic byte-for-byte.
   - In `set_resource_entitlement`: reject `materials_folder` when the target is `library_type='mcq_bank'` (`mcq_bank_access_is_subject_level`). For `materials_folder` and `pearl_point`, apply the same `admin_can_access_year` check that `ospe_station` already has for `manage_materials`-only admins (F8). **Exception (R2 review correction):** universal `career_counseling_series` folders keep `year_id` NULL and are **not** year-scoped — any `manage_materials` / `grant_resource_access` admin may set their entitlement (same CCS admin semantics as bin/purge).
   - **No data rewrite** of the 82 shadow rows. They become inert.
   - Revoke and grant to match the existing grants exactly.
3. Paste the previous function bodies, verbatim, into the PR description so a rollback migration is mechanical.

## 5. Tests (synthetic users only; disposable Postgres / staging; never real accounts)

**Fixtures:**
- Students:
  - `S_free`: active, enrolled in Y1, no subscription.
  - `S_sub`: live subscription.
  - `S_rf`: restricted on one Free notes folder.
  - `S_rp`: restricted on `practice_subject` P.
  - `S_wy`: enrolled in Y3.
  - `S_susp`: suspended.
  - `S_noenr`: no active enrollment.
- Admins (Y1 only unless stated):
  - `A_main`.
  - `A_mat`: `manage_materials`.
  - `A_mcq`: `edit_questions`.
  - `A_view`: `view_students`.
  - `A_restr`: `restrict_students` only.
  - `A_anl`: `view_analytics` only.
  - `A_fin`: `manage_subscriptions` + `review_subscription_applications`.
  - `A_pay`: `manage_payment_settings` only.
  - `A_none`: admin role with no permissions.

**Batch 2 (pgTAP, new file; then re-run the existing reattempt, grouping, resource-entitlement and MCQ Bank suites):**
- Positive tests:
  - Notes folder Paid→Free: `S_free` passes `accessible_folder_ids_among` and `authorize_study_object`.
  - Subject P Free: `S_free` lists MCQ Bank folders, opens their PDFs and can practice.
  - `S_sub` keeps every access.
  - An explicit folder grant still works (if kept).
- Negative tests:
  - Subject P Paid with shadow folder `free`: `S_free` is **denied** PDF authorization and the folder is absent from `accessible_folder_ids` and search.
  - `S_rp` is denied P's MCQ Bank PDFs even when P is Free.
  - `S_rf`, `S_wy`, `S_susp` and `S_noenr` are denied on a Free folder.
  - Prof. Session Free folder: `S_free` stays locked.
  - `set_resource_entitlement('materials_folder', <shadow>)` raises `mcq_bank_access_is_subject_level`.
  - `A_mat` (Y1) on a Y3 folder or pearl raises `permission_denied`.
  - `anon` and students calling `set_resource_entitlement` are denied.
  - Universal CCS (`year_id` NULL): `A_mat` and Main Admin can set entitlement; unknown folder/pearl ids raise `resource not found`; students denied.

**Batch 1 (unit + Playwright on staging):**
- Unit: a full permission → section matrix for `student360SectionsForPermissions`. PR #12's tests keep passing, and the Auth loader is **not called** for `A_restr`, `A_anl` or `A_fin`.
- Browser, Student 360:
  - `A_view`: all sections, with contact.
  - `A_restr`: name, status and actions; no email, contact, college or last login.
  - `A_anl`: stats, tests and practice; no name, biodata, subscription or payments; status shows "—".
  - `A_fin`: subscription and payments for a Y1 student; for a Y3 student, no subscription data and no biodata.
  - `A_pay` and `A_none`: denied.
- Browser, folders:
  - Admin toggles a Notes folder Paid→Free; `S_free` sees it unlocked **without a manual reload** (PR #16 path) and opens the PDF.
  - The admin MCQ Bank tab shows "follows subject" with a working link.
  - Toggling the subject to Free unlocks `S_free`'s MCQ Bank.
- Static checks at the exact SHA: `tsc --noEmit`, ESLint on changed files, Next.js typegen.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Batch 2 **relocks** paid MCQ Bank PDFs that non-subscribers can currently reach through search or a direct link. This is intended, but visible to users. | Founder sign-off on D1 (a). Note the change in the release notes. Subscribers and Free subjects are unaffected (tested). |
| Performance regression on hot access functions | Keep them set-based. Run `EXPLAIN ANALYZE` on staging for `get_academic_tree` and Prof. Session day load against the baseline in [performance-baseline.md](../performance-baseline.md). |
| Removing the folder-grant branch strands deliberate grants | Step 0 count decides; default is to keep grants. |
| Student 360 leaking biodata through the service-role Auth lookup | `canReadBiodata` is tied to `view_students` only, with a unit test that the loader is not called. |
| Analytics-only staff lose the name they never legitimately had | This matches RLS; noted as a default in §3. |
| Live function bodies differ from the repo | Step 0 diff. If they differ, stop and reconcile before writing the migration. |
| Rollback | Batch 1: re-point the release symlink. Batch 2: forward-only rollback migration that restores the verbatim prior bodies (prepared in the PR, rehearsed on disposable Postgres). |

## 7. Acceptance criteria

1. An eligible enrolled non-subscriber sees a non-MCQ folder unlocked and can open its items after an admin sets it Free, without a manual refresh. Paid→Free→Paid round-trips correctly.
2. The admin MCQ Bank UI no longer reports a folder-level change that students never see. The subject switch unlocks MCQ Bank end to end.
3. Paid MCQ Bank PDFs are not openable or searchable by non-entitled students. Restrictions, wrong year, suspended accounts and missing enrollment are always denied.
4. Prof. Session stays subscription-locked.
5. Each admitted Student 360 permission opens the page and sees only its sections. Biodata and contact require `view_students`. No permission is widened in SQL.
6. All new and existing pgTAP and unit suites pass, plus TypeScript, ESLint and typegen at the exact SHA.

## 8. Release gates and dependencies

```
Step 0 (read-only) ──► Batch 2 design lock (D1) ──► Batch 2 staging pgTAP + browser ──► founder prod-migration approval ──► release
PR #16 + PR #12 ──► Batch 1 (in app-only integration with #10/#14/#15) ──► staging browser smokes ──► founder app-release approval ──► release
```

- Batch 1 does not depend on Batch 2. Ship it first; 1A on its own already removes the misleading control.
- Batch 2 is an independent R2 DB gate, like PR #13. The two migrations may share one approved maintenance window but stay separate files and separate PRs.
- Staging sign-offs in `docs/validation/` do **not** authorize production. Every production deploy or migration needs its own scoped founder approval. ChatGPT independently verifies the deployed SHA and behaviour (`PROD_PASS`) and updates Issue #11.

## 9. Progress log

- **2026-11-23 — Batch 2 R2 CCS correction (Sonnet):** ChatGPT review on PR #18 `67eb76e` blocked staging: `set_resource_entitlement` treated NULL `year_id` as missing and rejected universal Career Counseling Series folders. Fixed in the same unapplied migration (CCS exception; ordinary folders/pearls still year-scoped). pgTAP `249` expanded to 53 checks (CCS +/-, cross-class pearl, unknown ids). Disposable `supabase/postgres:17.6.1.166`: **53/53 PASS**; rollback SQL → forward re-apply → 53/53 PASS again. Full suite: **17** baseline failures classified (stale catalog count, temp-table grants, fixture FK/char(1), unrelated RBAC/drive_url) — none in 249 / MCQ gate / search / academic folder suites; **not weakened**. Staging readiness (read-only): `staging.medversepk.com` health 200; `.env.e2e.staging` has admin + free/paid student keys for PR #17 browser; migration `20261123150000` **not** applied on staging (needs approval). PR #17 left unchanged.
