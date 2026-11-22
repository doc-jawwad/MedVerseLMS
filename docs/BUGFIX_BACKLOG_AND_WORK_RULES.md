# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-25 (Issue 10 Fixed — verification pending; Issue 11 Verified preserved; Issue 8 closure preserved)

Latest staging update and historical verification notes are retained below. This document is the source of truth for the user-reported MedVerse LMS issue queue and the working rules for addressing it. Keep it updated as issues are investigated, fixed, tested, and released. Do not replace this queue with a different checklist or drift into unrelated production-readiness work.

## Required workflow

1. Work through confirmed reported issues one at a time, in the listed order, unless Jawwad explicitly reprioritizes them.
2. Before each fix, inspect relevant project documentation, implementation, and tests. Establish the actual defect and intended behavior from project evidence; do not invent requirements.
3. Use Cursor for code implementation. ChatGPT coordinates and prepares Cursor-ready prompts; Claude is for content writing; Grok is for analysis/monitoring. Do not switch these roles without being asked.
4. Keep prompts token-friendly, focused, and limited to the current issue. Do not combine unrelated fixes or refactor unrelated areas.
5. Preserve existing functionality, data/history, authorization and permissions, and configured test time limits. Prefer the smallest safe change that fixes a demonstrated defect.
6. Add or update focused regression tests. Run relevant tests and required type/lint checks, then report the root cause, files changed, test evidence, and any unresolved uncertainty.
7. If expected behavior is ambiguous in the repository, stop and ask for clarification or report the ambiguity instead of guessing.
8. Do not mark an issue technically verified based only on code changes or a user status instruction. Keep user-reported status distinct from independently verified evidence.
9. Do not push branches, merge pull requests, deploy, run production writes/migrations, restart production services, or change shared infrastructure/permissions without Jawwad's explicit approval. Production promotion requires separate explicit approval.
10. Do not repeat completed work, rerun broad checks without a reason, or divert into release checklists and unrelated deferred backlog while an item in this queue remains active.
11. After the current issue is verified, update this document and move to the next confirmed issue.

## User-reported issue queue

Status meanings: **Not started**, **Investigating**, **In progress**, **Fixed — verification pending**, **Verified**, **Blocked**, and **User-marked solved — verification not independently rechecked**. The last status records Jawwad's requested tracking state without claiming new verification evidence.

| Order | Reported issue | Status / notes |
|---|---|---|
| 1 | Students cannot reattempt tests. | **On production (release verified 2026-10-24).** Ported onto Issue 5 prodline (`8745ef4`) as branch `fix/issue-1-reattempts-prodline` (cherry-picks `0bdb147`, `3a85a5c`, `8563b25`, `8d32548`, `7469e78`; conflict resolution kept Issue 4 `pickIncomingWithState` + Issue 5 One-Liner PDF). Live app SHA `171406595192629fbfb0cf60d9017fc07b71688f` (`/opt/medverse/releases/20261024T161149Z-1714065-issue1-reattempts`). DB: migrations `20261012090000` + `20261012120000` recorded; `tests.max_attempts` present (default `1`; all 221 live tests still at 1); `test_attempts_one_in_progress` replaces `test_attempts_one_live`; `ranked_test_attempts` view present; `start_attempt` has limit + resume-race (`v_live_n`) markers. Pre-migration backup `medverse/production/pre-migration/20261024T155849Z.dump.enc` (upload verified, 38144144 bytes). Verification: services active; public `/api/health` 200; focused unit tests 34/34; safe read-only `attempt_start_decision` contract checks (`new` / `already_submitted` / `attempt_limit_reached` / `attempt_no_mismatch`); attempt history intact (786 rows); Issue 5 `authorize_one_liner_object`/`r2_object_key` retained; unauth `/tests` `/dashboard` `/api/one-liners/...` 307; staging unchanged at `5cbebe3`. No live student retake browser session was run (would require raising `max_attempts` and writing attempts). Rollback app: `ln -sfn /opt/medverse/releases/20261024T153422Z-8745ef4-issue5-olpdf /opt/medverse/current && systemctl restart medverse-next`. SQL forward-only once any test has `max_attempts>1` with multi-attempt data. |
| 2 | Test-attempt and answer-key behavior is wrong. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. No new code/test evidence was checked as part of this tracker update. |
| 3 | Questions/tests are mixed across blocks. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. Historical note: filter-parity changes were verified on staging, but the earlier tracker said the original cross-Block mixing symptom had not been reproduced. Reconcile only if this issue is reopened; do not silently erase that historical uncertainty. |
| 4 | Paid dashboard hides open tests. | **Production and staging deployment confirmed from live VPS state; runtime behavior not freshly reproduced with a paid-student browser session.** First Issue 4 ship `/opt/medverse/releases/20261024T082314Z-c565008-issue4-dashboard`; retained through Issue 5 (`8745ef4`) and current Issue 1 release `1714065` (`pickIncomingWithState` present). Issue 4 is also on staging. Focused unit tests 7/7 and old-vs-new reproduction passed. No fresh live paid-student browser regression is claimed. Rollback target for Issue 4-era app: `ca817ec4d328749a7d2ee8f62e2f0dbe26137c31`. |
| 5 | Professional-session One-Liners need PDF support. | **On production (release verified 2026-10-24; retained under Issue 1 app `1714065`).** Optional private source PDF on Prof. Session `one_liners` (pearl pattern). First Issue 5 ship app SHA `8745ef419297349a1f5791a53308fdd18e4208ff` (`/opt/medverse/releases/20261024T153422Z-8745ef4-issue5-olpdf`); migration max remains `20261024140000` (`20261024120000` + `20261024140000`); pre-migration backup `medverse/production/pre-migration/20261024T153136Z.dump.enc` (upload verified, 38135824 bytes). Post–Issue 1 verify reconfirmed `r2_object_key`, `authorize_one_liner_object`/`has_live_subscription`, and slot-page `has_source_pdf`. Known remaining limitation (out of Issue 5 scope): student title/body SELECT remains enrollment-only under existing RLS. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue be marked resolved. No implementation, test, or production evidence was supplied or independently checked as part of this tracker update. |
| 8 | Professional-session content loads slowly. | **Closed — user-approved (auth SSR compare deferred); not independently Verified for end-to-end SSR.** Jawwad closed Issue 8 with the authenticated SSR before/after vs `5cbebe3` **explicitly deferred**. Staging RPC evidence retained: `e272f02` / `20261025T050539Z-e272f02-issue8` / DB `20261024180000`; re-seeded then cleaned (baseline 2/3/47/33/4/2). **Among under seed:** 13.5→4.0 ms cold/warm vs pre-fix 34.1/29.1 ms; tree 58/35 ms, 30613 chars; free locked. Auth SSR under seed recorded **post-only** for `e272f02` (not a fair before/after). TLS outliers ≠ SSR. pgTAP 240=6/6, 241=5/5. Prod untouched. **Do not claim** end-to-end SSR improvement was verified. |
| 9 | Samsung / non-Chrome browser problems. | **User-marked solved — verification not independently rechecked.** Jawwad requested this tracking state. No new browser/device evidence was independently rechecked as part of this tracker update. |
| 10 | Linking content defaults to the wrong subject (Medicine). | **Fixed — verification pending.** Root cause: Prof. Session day Practice CSV used `subjects[0]` (Final Year `sort_order` → Medicine) instead of the day’s `subject_id`. Fix: `resolveLinkingSubjectDefault` + `preferredSubjectId={subjectId}` on `DayPracticeCsvImport`. Existing question/folder/day mappings untouched (UI default only). Unit `linking-subject-default` 5/5. Branch `fix/issue-10-linking-subject-default` off `32d0f27`. Not deployed; no staging browser verify yet. Prod untouched. |
| 11 | Admins need manually organized groups for open tests. | **Verified on staging (2026-10-25).** Release `20261025T064327Z-32d0f27-issue11` / SHA `32d0f27a21537d052e3443dde3756731e22db7e3` (parent `e272f02`); staging DB head `20261025120000`. Browser smoke `ok`: admin create/rename/reorder/assign/delete; student Incoming group heading before “Other tests”; open A/B visible; closed fixture absent; cleanup leftover groups=0 tests=0. Regressions: unit 11/11 (grouping+Issue4 merge); pgTAP 247=15/15; Issue1/4/5/8 markers retained; unauth open-list 307; health 200. Prod untouched (`1714065` / DB `20261024140000`). |

## Current handoff

Issue 10 is **Fixed — verification pending** (local unit + wiring; needs staging deploy approval + short admin CSV smoke on a non-Medicine day). Issue 11 remains **Verified on staging**. Issue 8 remains **Closed — user-approved (auth SSR compare deferred)** — unchanged. Issue 9 is **User-marked solved — verification not independently rechecked**.

**Active item:** Issue 10 — staging verify after deploy approval. Production promotion of Issues 10/11 requires separate approval.

Jawwad has instructed that Issues 2, 3, 6, 7, and 9 be tracked as solved. This tracker records that requested status but does not claim those issues were independently reverified in this update.

## Issue 11 implementation reference

- **Status:** Verified on staging (2026-10-25)
- **Architecture:** Year-scoped presentation tables + SECURITY DEFINER admin RPCs; Dashboard Incoming overlay after `pickIncomingWithState`; does not touch `can_view_test` / `can_access_test` / attempts / answer keys.
- **Staging release:** `20261025T064327Z-32d0f27-issue11` / `32d0f27a21537d052e3443dde3756731e22db7e3` / DB `20261025120000`. Branch `fix/issue-11-open-list-groups-staging` (parent `e272f02`).
- **Migration:** `supabase/migrations/20261025120000_test_open_list_groups.sql` applied to `medverse_staging` only (rehearsal + `apply-staging-schema.sh`). Prod DB head remains `20261024140000`.
- **Browser smoke:** `scripts/_staging_issue11_browser_smoke_results.json` — admin create/rename/reorder/assign/delete ok; student group heading + Other tests + closed excluded; tagged fixtures cleaned.
- **Automated:** unit grouping+Issue4 merge 11/11; pgTAP 247=15/15; staging markers Issue1/5/8 + RLS tables present; health 200.
- **Remaining risk:** not on production; no production browser verify claimed.
- **Next issue:** Issue 10 — linking content subject default (Medicine).

## Issue 10 implementation reference

- **Status:** Fixed — verification pending (local only; not Verified on staging)
- **Root cause:** `DayPracticeCsvImport` initialized subject with `subjects[0]?.id`. Day page loads year subjects ordered by `sort_order` then `name`, so Final Year first option is Medicine. Day `subject_id` was already used for folders/one-liners but was not passed into CSV import.
- **Intended behavior (repo evidence):** day-scoped linking should default taxonomy subject to the day subject (same as `createOneLiner` / `addProfSessionDayFolder` on that page). Explicit admin override remains available via the subject Select. Do not bulk-rewrite existing `questions.subject_id` rows.
- **Change:** `src/lib/admin/linking-subject-default.ts`; `day-practice-csv-import.tsx` uses `resolveLinkingSubjectDefault({ subjects, preferredSubjectId })`; `day-content-admin.tsx` passes `preferredSubjectId={subjectId}`.
- **Out of scope (left unchanged):** Test Builder CSV / MCQ classify / Prof. Session list still use first-option defaults where there is no day context; those surfaces do not match the Medicine-by-`sort_order` linking bug as clearly.
- **Verification:** `node --experimental-strip-types --import ./tests/unit/shims/register-server-only.mjs --test tests/unit/linking-subject-default.test.ts` → 5/5. ESLint clean on new/changed CSV + helper files. Pre-existing: `day-content-admin` `react-hooks/set-state-in-effect` and repo `tsc` `LayoutProps` in `layout.tsx` (unrelated).
- **Remaining:** staging deploy approval; admin smoke — open non-Medicine day → CSV Import subject shows that day (not Medicine); explicit Medicine still selectable; reload keeps day default. No DB migration.
- **Next after Verified:** queue otherwise user-marked solved / closed / verified; await Jawwad for next confirmed item or production promotion.

## Issue 8 implementation reference

- **Status:** Closed — user-approved (auth SSR compare deferred); **not** independently Verified for end-to-end SSR
- **Root cause:** Wasted work on Prof. Session path — full-year re-eval in `accessible_folder_ids_among`, unused day aggregates in `get_academic_tree`, unscoped subjects fetch on Guidelines/LoS.
- **Staging release:** `20261025T050539Z-e272f02-issue8` / `e272f020c49a132e0e1ee1a0b39312aa663756b3` / DB `20261024180000`. Prod `1714065` / DB `20261024140000` untouched.
- **Seed (2026-10-25 re-run):** `ISSUE8_SEED_` via `issue8_seed.owned_rows`; post-seed 10/283/477/313/24/32; cleanup restored **2/3/47/33/4/2**; `owned_rows=0`; `seed_named=0`.
- **RPC under seed on e272f02** (`/tmp/issue8_measure_SEEDED_E272F02.txt`): among cold/warm **13.5 / 4.0 ms** (pre-fix seed baseline was **34.1 / 29.1 ms**); `get_academic_tree` 58 / 35 ms, payload **30613** chars; `accessible_folder_ids` ~26 ms; free `locked=true`; among scoped / tree slim markers true.
- **Auth SSR:** post-only under seed on `e272f02` (paid med ~621 ms). **No fair `5cbebe3` pair** — deferred by user decision (shared `:3010` only). Not claimed as Verified SSR improvement.
- **Regressions:** pgTAP 241=5/5, 240=6/6; Issue 1/4/5 markers present.
- **`LOADTEST_SSR_TIMING`:** not enabled.
- **Closure note:** User-approved close ≠ independently Verified end-to-end SSR. RPC staging evidence stands; SSR before/after remains deferred.
- **Next issue (per Jawwad):** Issue 11 — open-test groups.

## Reattempts implementation reference

Reported implementation branch: `feat/test-reattempts` (staging lineage). Production port: `fix/issue-1-reattempts-prodline` based on `8745ef4`.

Reported commits:
- `0bdb147` — feature and migration
- `3a85a5c` — concurrency-fix migration
- `8563b25`, `8d32548` — tests
- `7469e78` — E2E fixtures and reattempt-surface tests

Reported migrations:
- `supabase/migrations/20261012090000_test_max_attempts.sql`
- `supabase/migrations/20261012120000_start_attempt_resume_race.sql`

Reported staging verification included reattempt E2E coverage, resume/reload, exhaustion, review hold, best-attempt ranking, admin invalidation/history, closed-test refusal, two-tab race, class-change blocking, and single-attempt compatibility. A staging cleanup was reported completed on 2026-10-23.

Production verification (2026-10-24): schema/RPC markers, health 200, unit 34/34, read-only `attempt_start_decision` contract, attempt-row counts preserved, Issue 4/5 markers retained. No production student browser retake was exercised (would require raising `max_attempts` above 1).

## Update format

For each issue, record:
- **Status**
- **Root cause** (evidence-based)
- **Change** (files/commit, if applicable)
- **Verification** (commands, test counts, and environment)
- **Remaining risk/blocker**
- **Next issue**

Only mark technical verification when supported by actual results. Keep this document concise and current so the active issue and the next step are unambiguous.
