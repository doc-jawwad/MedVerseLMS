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
| 1 | Students cannot reattempt tests. | **On production (per Jawwad's instruction).** Reattempt support uses configurable `max_attempts` (default 1), preserves attempt history, and uses the best valid score for ranking. Historical implementation references: branch `feat/test-reattempts`; commits `0bdb147`, `3a85a5c`, `8563b25`, `8d32548`, `7469e78`; staging release `8563b25`, migration head `20261012120000`. Production status is recorded from Jawwad's instruction; no fresh production audit was run in this tracker update. |
| 2 | Test-attempt and answer-key behavior is wrong. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. No new code/test evidence was checked as part of this tracker update. |
| 3 | Questions/tests are mixed across blocks. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. Historical note: filter-parity changes were verified on staging, but the earlier tracker said the original cross-Block mixing symptom had not been reproduced. Reconcile only if this issue is reopened; do not silently erase that historical uncertainty. |
| 4 | Paid dashboard hides open tests. | **On production (per Jawwad's instruction); deployment evidence recorded.** Production SHA `c56500802f23f1aa46370c5e16e9a8e811a279a4`; release `/opt/medverse/releases/20261024T082314Z-c565008-issue4-dashboard`. Unit tests 7/7 and old-vs-new reproduction passed; service active and public `/api/health` returned 200. Full live production browser regression was not rerun because it requires database writes. Rollback target: `ca817ec4d328749a7d2ee8f62e2f0dbe26137c31`. |
| 5 | Professional-session One-Liners need PDF support. | **Staging validated — production not started.** Optional private source PDF on Prof. Session `one_liners` (pearl pattern). PR https://github.com/doc-jawwad/MedVerseLMS/pull/2 (base `fix/issue-5-continuous-pdf-scroll-staging` @ `a2966d9`, head `fix/issue-5-one-liner-pdf-staging` @ `1f61560`). Staging app SHA `1f61560e89ddf79f33eac1445b82d3b43c73277b` (`/opt/medverse-staging/releases/20261024T123837Z-1f61560-issue5-olpdf`); staging migration head `20261024120000`; pre-migration backup `medverse/vps-staging/pre-migration/20261024T123523Z.dump.enc` (HEAD size verified). Smoke (Playwright/API against staging.medversepk.com): admin attach/replace/clear; authorized student PDF 200; unauth 307; student REST r2_* denied 403; `has_source_pdf` readable; materials stream 206; PDF-scroll code present on release; soft-deleted authorize denied. PostgREST staging schema reload required after migration. Production unchanged (`c565008`, mig head `20261011120000`, no `one_liners.r2_object_key`). Residual: authz enrollment-scoped (not Prof. Session subscription); formal GitHub PR approval not required for this staging pass; full hard-delete R2 purge timer not exercised end-to-end. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | Not started. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |
| 11 | Admins need manually organized groups for open tests. | **Feature request — requirements captured; implementation not started.** Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

Issues 1 (reattempt tests) and 4 (open tests hidden from paid-student dashboards) are to be treated as **on production**, per Jawwad's instruction. Issue 4's recorded production SHA is `c56500802f23f1aa46370c5e16e9a8e811a279a4`; service and health checks were reported passing. Focused unit tests passed 7/7 and the old-vs-new reproduction passed; live production browser regression was not rerun because it requires database writes.

Jawwad has now instructed that Issues 2, 3, and 6 be tracked as solved. This tracker records that requested status but does not claim those three issues were independently reverified in this update.

**Active backlog item:** Issue 5 — Professional-session One-Liners PDF support is **staging-validated** (app `1f61560`, migration `20261024120000`); production deploy not started. Next confirmed issue after production decision: Issue 7 (PDF previous/next), unless Jawwad reprioritizes. Issue 11 remains a feature request and should not jump ahead unless Jawwad reprioritizes it.

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
