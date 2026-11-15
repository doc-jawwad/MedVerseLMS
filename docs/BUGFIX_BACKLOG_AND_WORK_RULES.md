# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-24 (Issue 8 local commit; staging not authorized)

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
| 8 | Professional-session content loads slowly. | **Fixed — verification pending (local commit only; not pushed/deployed).** Branch `fix/issue-8-prof-session-content-load` based on `1714065`. Independent review: SAFE for staging after explicit approval. Migration `20261024180000` (scoped `among` + slim day JSON); app subjects query scope + `ssrSpan`. Pre-commit AUTOMATED: unit 4/4; pgTAP 240+241 = 11/11. Full unit suite still has 2 **unrelated** failures (backup Cloud PGHOST; CRON_SECRET unset)—not claimed passing. User-facing multi-second delay still not reproduced locally. Keep in progress until staging before/after SSR TTFB + RPC timings (plan in Issue 8 reference). |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |
| 11 | Admins need manually organized groups for open tests. | **Feature request — requirements captured; implementation not started.** Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

Issue 8 is **committed locally** on `fix/issue-8-prof-session-content-load` (base `1714065`); **not pushed, not deployed**. Status remains Fixed — verification pending until explicit staging authorization and before/after performance measurements. Issues 1/4/5 remain on that base. Staging tip unchanged until an approved Issue 8 ship.

Jawwad has instructed that Issues 2, 3, 6, and 7 be tracked as solved. This tracker records that requested status but does not claim those issues were independently reverified in this update.

**Active backlog item:** Issue 8 — in progress (local commit done; awaiting staging authorization + measurements). Next after Issue 8 closes: Issue 9. Issue 11 remains a feature request.

## Issue 8 implementation reference

- **Status:** Fixed — verification pending (local commit; independent review PASS for staging eligibility; staging not authorized)
- **Root cause:** Wasted work on the Prof. Session student path — full-year folder-access re-eval inside `accessible_folder_ids_among`, unused per-day aggregates inside `get_academic_tree`, and unscoped subjects fetch on day Guidelines/LoS. Multi-second end-to-end slowness not reproduced locally.
- **Change:** `supabase/migrations/20261024180000_prof_session_content_load_perf.sql`; `src/components/library/material-library-page.tsx`; `src/lib/academic-tree/load-tree.ts`; tests `241_prof_session_content_load_perf.sql`, `tests/unit/prof-session-content-load.test.ts`
- **Independent review (2026-10-24, STATIC + AUTOMATED recheck):** Safe to proceed to staging with approval. No required code changes found for access/ordering/Issue 1–4–5 preservation. Optional coverage gaps (not blockers): explicit `among(null)` / empty-array cases; MANUAL Academic Notes page smoke (also uses `among`); no browser E2E latency assertion. `LOADTEST_SSR_TIMING` is gated to `MEDVERSE_ENV=loadtest` only — do not enable on staging/production; use browser TTFB + DB RPC timings instead.
- **Verification so far:** unit 4/4; pgTAP 240+241 (11/11); local before/after micro-benchmarks (among scoped vs full; tree payload 18505→15157). Full unit suite 2 unrelated failures noted, not attributed to Issue 8.
- **Staging verification plan (requires explicit deploy approval; no prod writes):**
  1. **Inventory (read-only):** published `prof_session_days`, day-scoped folders/materials, one_liners, day practice links, product subjects for the paid test student’s year.
  2. **Baseline (current staging SHA, before Issue 8):** paid subscribed student — cold+warm TTFB/p50/p95 for `/academic/prof-session`, `…/mcq-bank`, `…/mcq-bank/{day}`, `…/{day}/guidelines`, `…/los`, `…/one-liners`, `…/practice-mcqs`, `…/test-mcq`. Same routes as free student (expect SectionLock / empty days, not content leak).
  3. **Baseline DB/RPC (impersonated paid JWT, read-only):** wall time for `get_academic_tree('library')`, `accessible_folder_ids()`, `accessible_folder_ids_among(day_folder_ids)` (2–N ids from a real Guidelines day); payload size / day keys for one subject’s days.
  4. **Ship Issue 8 to staging only** (app + `20261024180000`); confirm migration head and Issue 1/4/5 markers retained.
  5. **After:** repeat steps 2–3. Correctness smoke: slot chrome order; paid Guidelines unlock; free denied; Issue 5 one-liner PDF authorize still subscription-gated; Issue 4 `pickIncomingWithState` still on dashboard; Issue 1 `max_attempts` / start path unchanged.
  6. **Declare user-facing improvement only if** guidelines/day-list TTFB p50 (and preferably p95) drop materially vs baseline under the same inventory; RPC times for `among` and tree should move in the same direction. If SSR TTFB is flat while RPC improves, record “wasted work removed; user symptom not confirmed fixed.”
- **Evidence still required before Status = Verified:** staging before/after SSR TTFB with realistic content volume (MANUAL or scripted against staging); matching RPC timings; correctness smokes above. Local unit/pgTAP alone are insufficient.
- **Remaining risk/blocker:** Staging/production RTT and auth waterfall may dominate; uncommitted Issue 8 files must be committed before any ship; no push/deploy without Jawwad approval.
- **Next issue:** Issue 9 after Issue 8 staging (then prod) verification, or Jawwad reprioritizes

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
