# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-24

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
| 1 | Students cannot reattempt tests. | Implementation and staging validation were reported for configurable `max_attempts` (default 1), preserving attempt history and using the best valid score for ranking. Work was reported on local feature branch `feat/test-reattempts`; it had not been pushed or deployed in the earlier tracker note. Staging app release reported as `8563b25`, migration head `20261012120000`. Do not restart this work unless new evidence identifies a remaining defect. |
| 2 | Test-attempt and answer-key behavior is wrong. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. No new code/test evidence was checked as part of this tracker update. |
| 3 | Questions/tests are mixed across blocks. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. Historical note: filter-parity changes were verified on staging, but the earlier tracker said the original cross-Block mixing symptom had not been reproduced. Reconcile only if this issue is reopened; do not silently erase that historical uncertainty. |
| 4 | Paid dashboard hides open tests. | **Production deployed; post-deployment checks reported passing.** Production SHA `c56500802f23f1aa46370c5e16e9a8e811a279a4`; release `/opt/medverse/releases/20261024T082314Z-c565008-issue4-dashboard`. Unit tests 7/7 and old-vs-new reproduction passed; service active and public `/api/health` returned 200. Full live production browser regression was not rerun because it requires database writes. Rollback target: `ca817ec4d328749a7d2ee8f62e2f0dbe26137c31`. |
| 5 | Professional-session One-Liners need PDF support. | Not started. This is the original backlog issue identity; do not confuse it with the later release task named “Issue #5” for continuous PDF touch scrolling. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | Not started. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Tests lack block-wise sections. | Not started. Keep this distinct from Issue 12: inspect existing test-builder/test-section behavior and confirm the intended structure before implementation. |
| 11 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |
| 12 | Admins need manually organized groups for open tests. | **New feature request — requirements captured; implementation not started.** Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Distinct from Issue 10: this is admin-managed organization of the student-facing open-test list, not merely sections inside a test or test builder. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

Issue 4 (paid dashboard hiding open tests) is reported deployed to production at `c56500802f23f1aa46370c5e16e9a8e811a279a4`, with service and health checks passing. Focused unit tests passed 7/7 and the old-vs-new reproduction passed; live production browser regression was not rerun because it requires database writes.

Jawwad has now instructed that Issues 2, 3, and 6 be tracked as solved. This tracker records that requested status but does not claim those three issues were independently reverified in this update.

**Next backlog item:** Issue 5 — Professional-session One-Liners PDF support, following the original queue order. Issue 12 is captured as a new feature request and should not jump ahead unless Jawwad reprioritizes it. Before any code change, inspect the relevant repo docs, implementation, and tests; use Cursor for implementation and ChatGPT for coordination/review.

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
