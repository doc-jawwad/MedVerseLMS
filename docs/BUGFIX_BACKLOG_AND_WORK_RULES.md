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
| 5 | Professional-session One-Liners need PDF support. | **Investigating — root cause identified; implementation not started.** This is a missing feature, not a broken PDF path: Prof. Session day `one_liners` currently support title/body and day linking only, while `docs/architecture.md` specifies an optional PDF. Reuse the existing Pearl optional source-PDF pattern (`study-content/` private R2 object → authorization RPC → `/api/one-liners/[id]` private stream); do not merge with `pearl_points` or Academic One Liner material folders / `MaterialLibraryPage`. Proposed scope: migration with private R2 metadata and generated `has_source_pdf`; authorization matching admin-year and published/enrolled-student access; attach/clear actions; admin editor upload/clear UI; student day-slot `has_source_pdf` selection and open-tab link; safe bin purge/reference checks; align `docs/database.md` with architecture. Acceptance tests: authorization allow/deny; student queries expose the flag but not R2 keys/metadata; attach/replace/clear and failure cleanup; bin purge queues only unreferenced keys; entitled student can open PDF and denied user gets 403; existing Pearl PDF, Academic One Liner materials, and free Prof. Session lock remain unchanged. Before implementation, confirm: open-tab link vs full `PdfViewer`; admin CMS editor only vs also day-content-admin creation form; PDF supplement vs allowing PDF-only rows. Distinct from the separate continuous PDF touch-scroll work on `fix/issue-5-continuous-pdf-scroll`. No code changed during this investigation. |
| 6 | PDFs fail or remain stuck loading. | **User-marked solved — verification not independently rechecked.** Jawwad explicitly requested that this issue remain marked solved. |
| 7 | PDF reader lacks previous/next navigation. | Not started. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |
| 11 | Admins need manually organized groups for open tests. | **Feature request — requirements captured; implementation not started.** Admin creates and names blocks/subjects (or other groups), assigns tests to groups, and manually reorders tests. Students see currently open, not-yet-closed tests grouped and ordered accordingly. Closed tests must not appear in this open-test view. Define a safe fallback for ungrouped tests so they do not disappear. Preserve existing availability rules, attempt history, answer-key behavior, permissions, and test entitlements. Before implementation, inspect existing schemas/UI and document dependencies, migration needs, and acceptance tests; do not make production changes without approval. |

## Current handoff

Issues 1 (reattempt tests) and 4 (open tests hidden from paid-student dashboards) are to be treated as **on production**, per Jawwad's instruction. Issue 4's recorded production SHA is `c56500802f23f1aa46370c5e16e9a8e811a279a4`; service and health checks were reported passing. Focused unit tests passed 7/7 and the old-vs-new reproduction passed; live production browser regression was not rerun because it requires database writes.

Jawwad has now instructed that Issues 2, 3, and 6 be tracked as solved. This tracker records that requested status but does not claim those three issues were independently reverified in this update.

**Active backlog item:** Issue 5 — Professional-session One-Liners PDF support. Investigation identifies a missing optional-PDF feature; implementation has not started. Resolve the three product-scope questions recorded in Issue 5 before coding, then inspect the relevant repo docs, implementation, and tests. Use Cursor for implementation and ChatGPT for coordination/review. Issue 11 remains recorded as a feature request and should not jump ahead unless Jawwad reprioritizes it.

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
