# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-25 (Issues 10–11 verified on production; queue 1–11 reviewed)

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
| 4 | Paid dashboard hides open tests. | **Verified on production (2026-10-25).** Retained in production release `9f460a49e0027d846bd9510f995f35979b15caba` (`20261025T083414Z-9f460a4-issue10-11`). Earlier focused unit tests 7/7 and old-vs-new reproduction passed. |
| 5 | Professional-session One-Liners need PDF support. | **On production (release verified 2026-10-24; retained under Issue 1 app `1714065`).** Optional private source PDF on Prof. Session `one_liners` (pearl pattern). First Issue 5 ship app SHA `8745ef419297349a1f5791a53308fdd18e4208ff` (`/opt/medverse/releases/20261024T153422Z-8745ef4-issue5-olpdf`); migration max remains `20261024140000` (`20261024120000` + `20261024140000`); pre-migration backup `medverse/production/pre-migration/20261024T153136Z.dump.enc` (upload verified, 38135824 bytes). Post–Issue 1 verify reconfirmed `r2_object_key`, `authorize_one_liner_object`/`has_live_subscription`, and slot-page `has_source_pdf`. Known remaining limitation (out of Issue 5 scope): student title/body SELECT remains enrollment-only under existing RLS. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue be marked resolved. No implementation, test, or production evidence was supplied or independently checked as part of this tracker update. |
| 8 | Professional-session content loads slowly. | **Closed — user-approved; authenticated SSR comparison deferred; end-to-end SSR improvement not independently verified. Not promoted to production.** Fix commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69` remains on `fix/issue-8-prof-session-content-load`; migration `20261024180000_prof_session_content_load_perf.sql`. Focused unit 4/4 and pgTAP 240 + 241 (11/11) passed; RPC seeded performance improved in reported measurements. Comparable authenticated SSR before/after evidence was unavailable because the shared staging Next instance could not safely be rolled back during other users' work. Jawwad approved closing Issue 8 with this limitation. Do not promote without separate explicit approval. | Local implementation committed on branch `fix/issue-8-prof-session-content-load`, commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69`. Changes: migration `20261024180000_prof_session_content_load_perf.sql` scopes folder-access lookup and removes unused day aggregates; subject-label query is scoped when `subjectId` is known; tree RPC timing instrumentation added. Focused Issue 8 unit tests 4/4; pgTAP tests 240 + 241 passed (11/11); touched-file type/lint checks clean. Full unit suite had two unrelated failures: backup-to-R2 Cloud PGHOST dry-run and missing `CRON_SECRET`; full suite not claimed passing. Staging deployment and comparable before/after TTFB/RPC measurements remain pending. No push/deploy or production changes have been performed as part of this local commit. |
| 9 | Samsung / non-Chrome browser problems. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that Issue 9 remain marked solved. Original device/symptom details were insufficient to independently reproduce the report; earlier browser-API/PDF hypotheses remain unconfirmed. Do not reopen unless requested. |
| 10 | Linking content defaults to the wrong subject (Medicine). | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Authenticated browser smoke passed on a Surgery day: CSV subject defaulted to Surgery, Medicine remained selectable, and the chosen Surgery subject persisted after reload. Tagged cleanup confirmed. |
| 11 | Admins need manually organized groups for open tests. | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Authenticated browser smoke passed: admin group create/rename/reorder/assignment; student Incoming group appeared before “Other tests”; closed test was absent. Tagged cleanup confirmed. | Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

**Queue 1–11 status (2026-10-25):** Jawwad reports Issues 10 and 11 **Verified on production**. Current production app SHA is `9f460a49e0027d846bd9510f995f35979b15caba`, release `/opt/medverse/releases/20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Production release lineage used the Issue 1 production baseline plus Issue 10/11 changes; staging SHAs were not deployed, and Issue 8 migration/fix is not in production. User-reported post-release evidence: service/health checks passed, Issue 8 migration absent, historical attempts/tests preserved, and unauthenticated protected routes redirect to login. Production browser checks for Issue 10 and Issue 11 passed on 2026-10-25. Issue 10 verified Surgery CSV default, Medicine selection, and persistence after reload. Issue 11 verified admin group CRUD/reorder/assignment, student group ordering before “Other tests,” and exclusion of closed tests. Tagged cleanup left zero fixture days/groups/tests. Dedicated test Auth accounts are retained (`e2e-prod-admin@medverse.local`, `e2e-prod-student@medverse.local`) using gitignored `.env.e2e.production`; do not commit or expose credentials.

Issue 1's reattempt behavior remains on the current release: `max_attempts` defaults to 1 unless an admin changes it; attempt history is preserved. Issue 5's One-Liner PDF support and Issue 4 dashboard fix are retained in the current release. Issues 2, 3, 6, and 7 remain **user-marked solved — verification not independently rechecked**; Issue 9 remains **user-marked solved — verification not independently rechecked**. Avoid upgrading those statuses without evidence.

**Queue state:** No active item remains in the reported Issue 1–11 queue. Issue 8 is closed with the authenticated SSR comparison deferred and its fix not promoted; keep that limitation explicit. The next priority should be chosen by Jawwad. Do not silently replace this queue with unrelated release/operations work.

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
