# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-24 (Issue 8 local fix committed; staging verification authorized)

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
| 8 | Professional-session content loads slowly. | **Fixed — verification pending.** Local implementation committed on branch `fix/issue-8-prof-session-content-load`, commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69`. Changes: migration `20261024180000_prof_session_content_load_perf.sql` scopes folder-access lookup and removes unused day aggregates; subject-label query is scoped when `subjectId` is known; tree RPC timing instrumentation added. Focused Issue 8 unit tests 4/4; pgTAP tests 240 + 241 passed (11/11); touched-file type/lint checks clean. Full unit suite had two unrelated failures: backup-to-R2 Cloud PGHOST dry-run and missing `CRON_SECRET`; full suite not claimed passing. Staging deployment and comparable before/after TTFB/RPC measurements remain pending. No push/deploy or production changes have been performed as part of this local commit. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |
| 11 | Admins need manually organized groups for open tests. | **Feature request — requirements captured; implementation not started.** Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

Issue 1 (reattempt tests) is **on production** (verified 2026-10-24): app `171406595192629fbfb0cf60d9017fc07b71688f`, release `20261024T161149Z-1714065-issue1-reattempts`, Issue 1 migrations recorded alongside migration max `20261024140000`, pre-migration backup `20261024T155849Z.dump.enc`. Default behavior remains single-attempt until an admin raises `max_attempts`. Issues 4 and 5 remain present on the live release. Staging remains `5cbebe30c229a4ea80a4d9f9fcc9168315face10`.

Jawwad has instructed that Issues 2, 3, 6, and 7 be tracked as solved. This tracker records that requested status but does not claim those issues were independently reverified in this update.

**Active backlog item:** Issue 8 — Professional-session content loads slowly (**Fixed — verification pending**; staging verification authorized, not yet evidenced). Issue 11 remains a feature request.

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
