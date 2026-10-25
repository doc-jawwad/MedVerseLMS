# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-25 (Issues 10–11 production-verified; Issues 1, 5 follow-up; Issue 12 recorded)

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
| 1 | Students cannot reattempt tests. | **Deployed; production verification incomplete (2026-10-25 audit).** Current live release `9f460a49e0027d846bd9510f995f35979b15caba` retains `max_attempts`, migrations `20261012090000` + `20261012120000`, `test_attempts_one_in_progress`, `ranked_test_attempts`, and `start_attempt` limit/resume-race logic. Health and focused unit tests 34/34 passed; read-only contract checks passed; attempt history preserved (786 rows at prior verification). All live tests remain `max_attempts=1`, so no production test currently allows a retake; no live student retake browser session has been run. **Next:** prepare a dedicated, non-critical test + dedicated student fixture plan, with exact `max_attempts` change, history-preserving verification, and restoration/recovery steps. Do not alter production settings or write attempts until the scoped plan is approved. SQL becomes forward-only once multi-attempt data exists. |
| 2 | Test-attempt and answer-key behavior is wrong. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. No new code/test evidence was checked as part of this tracker update. |
| 3 | Questions/tests are mixed across blocks. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. Historical note: filter-parity changes were verified on staging, but the earlier tracker said the original cross-Block mixing symptom had not been reproduced. Reconcile only if this issue is reopened; do not silently erase that historical uncertainty. |
| 4 | Paid dashboard hides open tests. | **Verified on production (2026-10-25).** Retained in production release `9f460a49e0027d846bd9510f995f35979b15caba` (`20261025T083414Z-9f460a4-issue10-11`). Earlier focused unit tests 7/7 and old-vs-new reproduction passed. |
| 5 | Professional-session One-Liners need PDF support. | **Deployed; production content-flow verification incomplete (2026-10-25 audit).** Current production lineage retains `one_liners.r2_object_key`, migrations `20261024120000` + `20261024140000`, `authorize_one_liner_object`, and `has_source_pdf` markers. Audit found **0 One-Liners with a PDF**, so real upload/authorized retrieval has not been exercised in production. Known out-of-scope limitation: student title/body SELECT remains enrollment-only under existing RLS. **Next:** verify with a dedicated non-sensitive test PDF and dedicated fixture, checking upload, authorized access, unauthorized denial, and cleanup; do not use real teaching/student content or change RLS without a separate finding/approval. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue be marked resolved. No implementation, test, or production evidence was supplied or independently checked as part of this tracker update. |
| 8 | Professional-session content loads slowly. | **Closed — user-approved; authenticated SSR comparison deferred; end-to-end SSR improvement not independently verified. Not promoted to production.** Fix commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69` remains on `fix/issue-8-prof-session-content-load`; migration `20261024180000_prof_session_content_load_perf.sql`. Focused unit 4/4 and pgTAP 240 + 241 (11/11) passed; RPC seeded performance improved in reported measurements. Comparable authenticated SSR before/after evidence was unavailable because the shared staging Next instance could not safely be rolled back during other users' work. Jawwad approved closing Issue 8 with this limitation. Do not promote without separate explicit approval. | Local implementation committed on branch `fix/issue-8-prof-session-content-load`, commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69`. Changes: migration `20261024180000_prof_session_content_load_perf.sql` scopes folder-access lookup and removes unused day aggregates; subject-label query is scoped when `subjectId` is known; tree RPC timing instrumentation added. Focused Issue 8 unit tests 4/4; pgTAP tests 240 + 241 passed (11/11); touched-file type/lint checks clean. Full unit suite had two unrelated failures: backup-to-R2 Cloud PGHOST dry-run and missing `CRON_SECRET`; full suite not claimed passing. Staging deployment and comparable before/after TTFB/RPC measurements remain pending. No push/deploy or production changes have been performed as part of this local commit. |
| 9 | Samsung / non-Chrome browser problems. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that Issue 9 remain marked solved. Original device/symptom details were insufficient to independently reproduce the report; earlier browser-API/PDF hypotheses remain unconfirmed. Do not reopen unless requested. |
| 10 | Linking content defaults to the wrong subject (Medicine). | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Authenticated browser smoke passed on a Surgery day: CSV subject defaulted to Surgery, Medicine remained selectable, and the chosen Surgery subject persisted after reload. Tagged cleanup confirmed. |
| 11 | Admins need manually organized groups for open tests. | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Authenticated browser smoke passed: admin group create/rename/reorder/assignment; student Incoming group appeared before “Other tests”; closed test was absent. Tagged cleanup confirmed. | Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |
| 12 | PDF reader touch scrolling broken / not continuous. | **Reported on production (2026-10-24; retained under live release `9f460a49e0027d846bd9510f995f35979b15caba`).** User reports first ship `ca817ec` / release `…ca817ec-issue5-pdf-scroll`; staging `a2966d9` / release `…a2966d9-issue5-pdf-scroll`. Earlier commits called this “Issue #5”; it is distinct from backlog Issue 5 (Professional-session One-Liner PDF support). Current runtime behavior not independently re-tested in this audit. **Next:** confirm intended touch-scrolling behavior on mobile browsers and run a focused production regression only if a safe existing test path is available; otherwise verify on staging first. |

## Current handoff

**Production baseline (2026-10-25):** app SHA `9f460a49e0027d846bd9510f995f35979b15caba`, release `/opt/medverse/releases/20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`, `medverse-next` active, `/api/health` 200. Issue 10 and Issue 11 are **verified on production** by authenticated browser tests. Issue 8 migration `20261024180000` is absent from production; Issue 8 remains closed by user approval with authenticated SSR comparison deferred and its fix unpromoted.

**Follow-up completion queue:**
1. **Issue 1:** complete a controlled retake smoke using a dedicated student and non-critical test. All live tests currently have `max_attempts=1`; no production retake browser test has been run. Prepare and approve the exact change, test, and restoration plan before any production writes; preserve attempt history.
2. **Issue 5:** verify One-Liner PDF upload and authorized retrieval using a dedicated non-sensitive test PDF. Audit found zero production One-Liners with a PDF; retain the known enrollment-only student title/body RLS limitation unless a separate scoped issue is approved.
3. **Issue 12:** verify mobile PDF touch scrolling behavior. Reported as shipped and retained under the live release; current behavior was not independently re-tested in this audit. Keep it distinct from Issue 5 (One-Liner PDF support).

Issues 10 and 11 production smoke cleanup left zero tagged fixture days/groups/tests. Dedicated production E2E Auth accounts are retained (`e2e-prod-admin@medverse.local`, `e2e-prod-student@medverse.local`) via gitignored `.env.e2e.production`; never commit or expose credentials. Issue 11 groups count is currently zero, so feature is deployed but no real groups are configured. Issue 1 and Issue 5 are deployed but have the above live-content verification gaps.

Issues 2, 3, 6, 7, and 9 remain **user-marked solved — verification not independently rechecked**. Issue 4 is verified on production. Do not upgrade status without evidence. Do not promote Issue 8 without separate explicit approval.

**Next issue:** Start with a read-only implementation and fixture review for Issue 1; present a minimal production smoke plan for approval before any write. Then verify Issue 5 and Issue 12 with dedicated fixtures. Close each only after observed results are recorded.
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
