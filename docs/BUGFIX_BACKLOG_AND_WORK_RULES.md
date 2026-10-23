# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-23

Latest Issue 3 update: Cursor reports commits `3fc7224` and `16a74f4` on local `feat/test-reattempts`, not pushed, with no tracked-file changes remaining. Commit `16a74f4` aligns empty import-batch behavior: when a requested batch resolves to no questions (including unknown/invisible IDs), the visible pool and random-add both yield zero. Latest reported focused tests pass 17/17; `tsc --noEmit` is clean. Full unit suite: 797/798, with the `CRON_SECRET` auto-submit test reported as a baseline failure. Touched-file ESLint reports a pre-existing `Date.now()`-during-render error at `page.tsx:317`. No live DB or staging E2E run has occurred; staging E2E is the next verification step. A selected unknown batch can leave the pool label absent (cosmetic, noted but not changed). Do not impose Block purity without an approved requirement.

This document is the source of truth for the user-reported MedVerse LMS issue queue and the working rules for addressing it. Keep it updated as issues are investigated, fixed, tested, and released. Do not replace this queue with a different checklist or drift into unrelated production-readiness work.

## Required workflow

1. Work through confirmed reported issues one at a time, in the listed order, unless Jawwad explicitly reprioritizes them.
2. Before each fix, inspect relevant project documentation, implementation, and tests. Establish the actual defect and intended behavior from project evidence; do not invent requirements.
3. Use Cursor for code implementation. ChatGPT coordinates and prepares Cursor-ready prompts; Claude is for content writing; Grok is for analysis/monitoring. Do not switch these roles without being asked.
4. Keep prompts token-friendly, focused, and limited to the current issue. Do not combine unrelated fixes or refactor unrelated areas.
5. Preserve existing functionality, data/history, authorization and permissions, and configured test time limits. Prefer the smallest safe change that fixes a demonstrated defect.
6. Add or update focused regression tests. Run relevant tests and required type/lint checks, then report the root cause, files changed, test evidence, and any unresolved uncertainty.
7. If expected behavior is ambiguous in the repository, stop and ask for clarification or report the ambiguity instead of guessing.
8. Do not mark an issue complete based only on code changes. Record its verification status and environment.
9. Do not push branches, merge pull requests, deploy, run production writes/migrations, restart production services, or change shared infrastructure/permissions without Jawwad's explicit approval. Production promotion requires separate explicit approval.
10. Do not repeat completed work, rerun broad checks without a reason, or divert into release checklists and unrelated deferred backlog while an item in this queue remains active.
11. After the current issue is verified, update this document and move to the next confirmed issue.

## User-reported issue queue

Track confirmed issues as **Not started**, **Investigating**, **In progress**, **Fixed — verification pending**, **Verified**, or **Blocked**. Items with no confirmed defect should be labelled **Unconfirmed — no action** and must not trigger speculative code changes.

| Order | Reported issue | Status / notes |
|---|---|---|
| 1 | Students cannot reattempt tests. | Implementation and staging validation were reported for configurable `max_attempts` (default 1), preserving attempt history and using the best valid score for ranking. Work is on local feature branch `feat/test-reattempts`; it has not been pushed or deployed. Staging app release reported as `8563b25`, migration head `20261012120000`. Do not restart this work unless new evidence identifies a remaining defect. |
| 2 | Test attempt and answer-key behavior is wrong. | **Unconfirmed — no action.** Jawwad confirmed no such issue has been reported. Do not investigate or change answer-key behavior unless a real report/evidence appears. |
| 3 | Questions/tests are mixed across blocks. | **Fixed — verification pending (narrow filter mismatch only).** Cursor reports local commits `3fc7224` and `16a74f4` on `feat/test-reattempts`, not pushed. The visible pool and random-add now share `q` text search and import-batch scope; import question IDs are looked up server-side. Empty, null, undefined, unknown, or invisible requested batches resolve to an empty pool rather than broadening to all questions. Latest reported focused tests: 17/17 pass; `tsc --noEmit` clean. Full unit suite: 797/798, with the `CRON_SECRET` auto-submit test reported as a baseline failure. Touched-file ESLint has a reported pre-existing `Date.now()` render error at `page.tsx:317`. No live DB/E2E run yet. **Next:** staging E2E for empty/unknown batch, populated batch plus search, and matching random-add scope. Unknown batch may not display a scope label (cosmetic). No cross-Block mixing defect has been reproduced; Block-purity is not an approved invariant. |
| 4 | Paid dashboard hides open tests. | Not started. |
| 5 | Professional-session One-Liners need PDF support. | Not started. |
| 6 | PDFs fail or remain stuck loading. | Not started. |
| 7 | PDF reader lacks previous/next navigation. | Not started. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Tests lack block-wise sections. | Not started. Confirm the intended section structure from existing product behavior/docs before implementation. |
| 11 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |

## Current handoff

The active task remains **Issue 3**, limited to the filter mismatch and its edge-case consistency. Cursor reports commits `3fc7224` and `16a74f4` locally on `feat/test-reattempts`; no push occurred. The empty-batch inconsistency is reported fixed and the focused checks are reported passing, but they were not rerun in this latest review and no live DB/E2E validation exists. Next: run the staging E2E spec on a draft test: (1) empty or unknown requested batch shows zero and random-add adds zero, (2) populated batch plus search narrows the visible pool, and (3) random-add draws only from that same narrowed scope. Do not push, deploy, modify schema/data, or impose Block purity. Issue 2 is unconfirmed and inactive.

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

Reported staging verification included reattempt E2E coverage, resume/reload, exhaustion, review hold, best-attempt ranking, admin invalidation/history, closed-test refusal, two-tab race, class-change blocking, and single-attempt compatibility. A staging cleanup was reported completed on 2026-10-23. These are conversation-reported results and should not be represented as newly rerun by this documentation update.

## Update format

For each confirmed issue, record:
- **Status**
- **Root cause** (evidence-based)
- **Change** (files/commit, if applicable)
- **Verification** (commands, test counts, and environment)
- **Remaining risk/blocker**
- **Next issue**

Only update statuses when supported by actual results. Keep this document concise and current so the active issue and the next step are unambiguous.
