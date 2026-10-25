# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-25 (Issue 13 verified on production)

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
| 1 | Students cannot reattempt tests. | **Closed by user instruction (2026-10-25); production verification incomplete.** Live release `9f460a49e0027d846bd9510f995f35979b15caba` retains `max_attempts`, migrations `20261012090000` + `20261012120000`, `test_attempts_one_in_progress`, `ranked_test_attempts`, and `start_attempt` limit/resume-race logic. Staging E2E `tests/e2e/reattempts.spec.ts` passed 5/5; pgTAP `245_test_reattempts.sql` passed 58/58; focused reattempt unit tests passed (latest reported 31/31; earlier checkpoint 34/34); concurrent/resume-race DB proofs passed. `node --check scripts/_prod_issue1_reattempt_smoke.mjs` passed. Updated production smoke harness was prepared, but production retake behavior was not verified. All live tests remained `max_attempts=1` at the last audit. This is a tracking closure only, not a claim of production verification. Do not resume unless Jawwad explicitly requests it. |
| 2 | Test-attempt and answer-key behavior is wrong. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. No new code/test evidence was checked as part of this tracker update. |
| 3 | Questions/tests are mixed across blocks. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. Historical note: filter-parity changes were verified on staging, but the earlier tracker said the original cross-Block mixing symptom had not been reproduced. Reconcile only if this issue is reopened; do not silently erase that historical uncertainty. |
| 4 | Paid dashboard hides open tests. | **Verified on production (2026-10-25).** Retained in production release `9f460a49e0027d846bd9510f995f35979b15caba` (`20261025T083414Z-9f460a4-issue10-11`). Earlier focused unit tests 7/7 and old-vs-new reproduction passed. |
| 5 | Professional-session One-Liners need PDF support. | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Smoke evidence: `scripts/_prod_issue5_olpdf_smoke_results.json`. Admin attach + persisted reference succeeded; unauthenticated request redirected (307); subscribed student received `200 application/pdf`; student without subscription received 403; UI Remove PDF succeeded and subsequent access returned 403; missing R2 object returned 502; cleanup left `leftover_one_liners=0` and fixture subscription deleted. Existing enrollment-only student title/body RLS limitation remains out of scope; no RLS change was made. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue be marked resolved. No implementation, test, or production evidence was supplied or independently checked as part of this tracker update. |
| 8 | Professional-session content loads slowly. | **Closed — user-approved; authenticated SSR comparison deferred; end-to-end SSR improvement not independently verified. Not promoted to production.** Fix commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69` remains on `fix/issue-8-prof-session-content-load`; migration `20261024180000_prof_session_content_load_perf.sql`. Focused unit 4/4 and pgTAP 240 + 241 (11/11) passed; RPC seeded performance improved in reported measurements. Comparable authenticated SSR before/after evidence was unavailable because the shared staging Next instance could not safely be rolled back during other users' work. Jawwad approved closing Issue 8 with this limitation. Do not promote without separate explicit approval. | Local implementation committed on branch `fix/issue-8-prof-session-content-load`, commit `fb6570e5b67ac2e6e2a3f2f2beba448dbc47dd69`. Changes: migration `20261024180000_prof_session_content_load_perf.sql` scopes folder-access lookup and removes unused day aggregates; subject-label query is scoped when `subjectId` is known; tree RPC timing instrumentation added. Focused Issue 8 unit tests 4/4; pgTAP tests 240 + 241 passed (11/11); touched-file type/lint checks clean. Full unit suite had two unrelated failures: backup-to-R2 Cloud PGHOST dry-run and missing `CRON_SECRET`; full suite not claimed passing. Staging deployment and comparable before/after TTFB/RPC measurements remain pending. No push/deploy or production changes have been performed as part of this local commit. |
| 9 | Samsung / non-Chrome browser problems. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that Issue 9 remain marked solved. Original device/symptom details were insufficient to independently reproduce the report; earlier browser-API/PDF hypotheses remain unconfirmed. Do not reopen unless requested. |
| 10 | Linking content defaults to the wrong subject (Medicine). | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Authenticated browser smoke passed on a Surgery day: CSV subject defaulted to Surgery, Medicine remained selectable, and the chosen Surgery subject persisted after reload. Tagged cleanup confirmed. |
| 11 | Admins need manually organized groups for open tests. | **Verified on production (2026-10-25).** Live release `9f460a49e0027d846bd9510f995f35979b15caba`, release `20261025T083414Z-9f460a4-issue10-11`, DB head `20261025120000`. Authenticated browser smoke passed: admin group create/rename/reorder/assignment; student Incoming group appeared before “Other tests”; closed test was absent. Tagged cleanup confirmed. | Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |
| 12 | PDF reader touch scrolling broken / not continuous. | **Closed by user instruction (2026-10-25); current behavior not independently re-tested.** Reported as shipped in production under release lineage `ca817ec` / `…ca817ec-issue5-pdf-scroll`; staging update `a2966d9` / `…a2966d9-issue5-pdf-scroll`. Distinct from backlog Issue 5 (One-Liner PDF support). This closure records the user's requested tracking state and does not claim a fresh mobile regression test. |
| 13 | Academic-tree search returns empty or inaccessible/poorly linked results. | **Verified on production (2026-10-25; based on Jawwad-provided deployment and smoke evidence).** Production migration `20261025160000` is applied to `medverse`; Issue 8 migration `20261024180000` remains absent. App commit `f68dd03`, release `/opt/medverse/releases/20261025T121009Z-f68dd03-issue13`. PostgREST schema reload and service restart completed; health returned 200. Production smoke artifact `scripts/_prod_issue13_search_smoke_results.json` reportedly passed: free One Liner and Clinical folder visible; Pearl Points and Prof. Session excluded for free users; paid Prof. Session, One Liner, Medicine and folder results plus UI checks passed. Fixture subscription removed. App-only rollback target: `/opt/medverse/releases/20261025T083414Z-9f460a4-issue10-11`; database schema is forward-only, so this is not a full application+schema rollback. Earlier staging verification is retained in the history above. Production status is based on Jawwad-provided evidence, not independently re-run in this session.

## Current handoff

**Production baseline (2026-10-25, updated after Issue 13 release):** app commit `f68dd03`, release `/opt/medverse/releases/20261025T121009Z-f68dd03-issue13`, database migration head includes `20261025160000`, `medverse-next` active per supplied report, PostgREST schema reload/service restart completed, `/api/health` 200. Issue 10 and Issue 11 remain verified on production. Issue 8 migration `20261024180000` remains absent from production; Issue 8 is closed by user approval with authenticated SSR comparison deferred and its fix unpromoted. App-only rollback target is `/opt/medverse/releases/20261025T083414Z-9f460a4-issue10-11`; schema is forward-only.

**Follow-up / next action:** Issue 13 (academic-tree search) is **verified on production** based on the supplied smoke artifact `scripts/_prod_issue13_search_smoke_results.json`. Free and paid search-access scenarios passed as reported; fixture subscription was removed. No further Issue 13 promotion step remains. Issues 1 and 12 remain closed by user instruction, with verification limitations recorded.

Issues 10 and 11 production smoke cleanup left zero tagged fixture days/groups/tests. Dedicated production E2E Auth accounts are retained (`e2e-prod-admin@medverse.local`, `e2e-prod-student@medverse.local`) via gitignored `.env.e2e.production`; never commit or expose credentials. Issue 11 groups count is currently zero, so feature is deployed but no real groups are configured. Issue 1 is closed by user instruction, but production retake behavior remains unverified. Issue 5 One-Liner PDF support is production-verified by the 2026-10-25 smoke described above.

Issues 2, 3, 6, 7, and 9 remain **user-marked solved — verification not independently rechecked**. Issue 4 is verified on production. Do not upgrade status without evidence. Do not promote Issue 8 without separate explicit approval.

**Next action:** Issue 13 is verified on production according to supplied deployment and smoke evidence. Continue with the next confirmed issue in the backlog order, unless Jawwad reprioritizes. Issues 1 and 12 were closed by user instruction on 2026-10-25; their outstanding verification limitations remain documented.
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
