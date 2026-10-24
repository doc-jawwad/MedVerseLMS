# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-24 (Issue 5 production release recorded)

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
| 1 | Students cannot reattempt tests. | **Production status unconfirmed — recorded as production per earlier instruction, not independently verified.** Reattempt support uses configurable `max_attempts` (default 1), preserves attempt history, and uses the best valid score for ranking. Historical implementation references: branch `feat/test-reattempts`; commits `0bdb147`, `3a85a5c`, `8563b25`, `8d32548`, `7469e78`; staging release `8563b25`, migration head `20261012120000`. No fresh production audit or direct production deployment evidence is available in this tracker. |
| 2 | Test-attempt and answer-key behavior is wrong. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. No new code/test evidence was checked as part of this tracker update. |
| 3 | Questions/tests are mixed across blocks. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. Historical note: filter-parity changes were verified on staging, but the earlier tracker said the original cross-Block mixing symptom had not been reproduced. Reconcile only if this issue is reopened; do not silently erase that historical uncertainty. |
| 4 | Paid dashboard hides open tests. | **Production deployment recorded; paid-student behavior not freshly confirmed.** Production SHA `c56500802f23f1aa46370c5e16e9a8e811a279a4`; release `/opt/medverse/releases/20261024T082314Z-c565008-issue4-dashboard`. Unit tests 7/7 and old-vs-new reproduction passed; service active and public `/api/health` returned 200. Full live production browser regression was not rerun because it requires database writes. Therefore, the deployment is recorded but the exact paid-student behavior is not independently confirmed live. Rollback target: `ca817ec4d328749a7d2ee8f62e2f0dbe26137c31`. |
| 5 | Professional-session One-Liners need PDF support. | **On production (release verified 2026-10-24).** Optional private source PDF on Prof. Session `one_liners` (pearl pattern). Production app SHA `8745ef419297349a1f5791a53308fdd18e4208ff` (`/opt/medverse/releases/20261024T153422Z-8745ef4-issue5-olpdf`); migration head `20261024140000` (`20261024120000` + `20261024140000`); pre-migration backup `medverse/production/pre-migration/20261024T153136Z.dump.enc` (upload verified, 38135824 bytes). Branch `fix/issue-5-one-liner-pdf-prodline` based on production `c565008`. Verification: services active; public `/api/health` 200; schema/RPC markers present (`r2_object_key`, `has_source_pdf`, `authorize_one_liner_object` with `has_live_subscription`, `get_one_liner_for_admin`, `r2_object_still_referenced` includes `one_liners`); Issue 4 dashboard + continuous PDF-scroll markers retained; unauth `/api/one-liners/...` 307; staging unchanged at `5cbebe30c229a4ea80a4d9f9fcc9168315face10`. Prior staging validation retained (free PDF 403 / paid 200). Rollback app target: `c565008` / `/opt/medverse/releases/20261024T082314Z-c565008-issue4-dashboard`. SQL is forward-only. Known remaining limitation (out of Issue 5 scope): student title/body SELECT remains enrollment-only under existing RLS. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue be marked resolved. No implementation, test, or production evidence was supplied or independently checked as part of this tracker update. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |
| 11 | Admins need manually organized groups for open tests. | **Feature request — requirements captured; implementation not started.** Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

Issue 1 (reattempt tests) was previously recorded as on production per Jawwad's instruction, but no independent production deployment evidence is currently recorded; treat its production status as **unconfirmed** until checked. Issue 4 (paid dashboard open tests) has a recorded production deployment at SHA `c56500802f23f1aa46370c5e16e9a8e811a279a4` (`/opt/medverse/releases/20261024T082314Z-c565008-issue4-dashboard`). Service/health checks were reported passing, and focused unit tests passed 7/7 with the old-vs-new reproduction; live paid-student production browser behavior was not reverified.

Jawwad has now instructed that Issues 2, 3, and 6 be tracked as solved. This tracker records that requested status but does not claim those three issues were independently reverified in this update.

**Active backlog item:** Issue 5 — Professional-session One-Liners PDF support is **on production** (app `8745ef419297349a1f5791a53308fdd18e4208ff`, migration head `20261024140000`, release `20261024T153422Z-8745ef4-issue5-olpdf`; verified 2026-10-24). Student title/body enrollment-only RLS remains a separate known limitation, not changed by Issue 5. Jawwad has marked Issue 7 (PDF reader previous/next navigation) resolved; this records the requested tracking state only, not independent verification. Next: Issue 8 (Professional-session content loads slowly) unless Jawwad reprioritizes. Issue 11 remains a feature request.

## Reattempts implementation reference

Reported implementation branch: `feat/test-reattempts`

Reported commits:
- `0bdb147` — feature and migration
- `3a85a5c` — concurrency-fix migration
- `8563b25`, `8d32548` — tests
- `7469e78` — E2E fixtures and reattempt-surface tests

Reported migrations:
- `supabase/migrations/20261012090000_test_max_attempts.sql`
- `supabase/migrations/20261012120000_start_attempt_resume_race.sql`

Reported staging verification included reattempt E2E coverage, resume/reload, exhaustion, review hold, best-attempt ranking, admin invalidation/history, closed-test refusal, two-tab race, class-change blocking, and single-attempt compatibility. A staging cleanup was reported completed on 2026-10-23. These are historical reported results and should not be represented as newly rerun by this documentation update.

## Update format

For each issue, record:
- **Status**
- **Root cause** (evidence-based)
- **Change** (files/commit, if applicable)
- **Verification** (commands, test counts, and environment)
- **Remaining risk/blocker**
- **Next issue**

Only mark technical verification when supported by actual results. Keep this document concise and current so the active issue and the next step are unambiguous.
