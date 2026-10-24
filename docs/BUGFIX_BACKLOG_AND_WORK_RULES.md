# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-24

Latest staging update: staging is running `16a74f42c0af8c41552c67f10b5f5fbc9275fb3f`; all 6 targeted scenarios in `tests/e2e/test-builder-random-import-text-filters.spec.ts` passed on staging. Staging `/api/health` returned 200. Deployment used detached unit `mv-staging-random-scope-deploy-16a74f4`; expected prior SHA `8563b25e0a0332d37810f29863bcc7d7a25784d8` was confirmed, activation completed, and production remained unchanged. Spec setup initially failed because the `import_batches` insert required `created_by = auth.uid()`; spec was corrected and committed as `464cc93`, with no app-code change in that commit. Cleanup check found zero live `e2eimp` questions, import batches, and draft tests; 8 soft-deleted fixture questions remain in Content Bin for scheduled purge in 7 days, and 2 fixture topics remain with books/chapters. Scenarios 2 and 3 validate UI zero-pool/disabled-button behavior, not the server-side zero-add guard. The filter-parity fix is verified on staging; the originally reported cross-Block mixing symptom remains unreproduced and open pending a concrete example. Nothing was pushed; production is unchanged. Issue 4 is deployed to staging at `0026cad1933a22b78e28819dcd7b8f8f8cf6afd1`; staging health returned 200 locally on the VPS and through the public URL from the VPS. Production remained unchanged. Browser verification is pending because workstation DNS resolution failed and staging has no qualifying student data. No database writes, seeding, or migrations were performed.

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
| 3 | Questions/tests are mixed across blocks. | **Filter-parity fix verified on staging; original cross-Block symptom remains open/unreproduced.** Commits `3fc7224` and `16a74f4`; staging runs `16a74f42c0af8c41552c67f10b5f5fbc9275fb3f`. All 6 targeted scenarios in `tests/e2e/test-builder-random-import-text-filters.spec.ts` passed: no batch (4 shown/added), empty batch (0 shown/added), unknown batch (0 shown/added), populated batch (only 2 shown/added and persists after reload), text search parity, and batch+search intersection (1 question). Staging health returned 200; deploy confirmed prior SHA `8563b25e0a0332d37810f29863bcc7d7a25784d8`, activated target, and left production unchanged. Spec setup defect fixed in `464cc93` (`created_by = auth.uid()` required by RLS); no app code changed in that commit. Cleanup: zero live `e2eimp` questions, import batches, or draft tests; 8 soft-deleted fixture questions remain in Content Bin for purge in 7 days; 2 fixture topics remain with books/chapters. Empty/unknown batch cases verify the UI only, not the server-side zero-add guard. **Do not mark the original cross-Block report resolved:** no reproduction; await a concrete example. Do not impose Block purity without an approved requirement. |
| 4 | Paid dashboard hides open tests. | **Fixed — verification pending; deployed to staging only.** Root cause: `deriveDashboardUpcomingFromCatalog` capped the published, not-yet-closed test catalog at 20 before the dashboard filtered to incoming states. Submitted/result-state tests could consume all 20 slots and hide a later open test. Commit `0026cad1933a22b78e28819dcd7b8f8f8cf6afd1` contains only the three fix/test files and remains local/unpushed. Staging was deployed from base `16a74f42c0af8c41552c67f10b5f5fbc9275fb3f`; release marker matches `0026cad`; guarded deployment reported activation complete and production unchanged. Staging `/api/health` returned 200 on VPS and public URL from VPS. Focused local tests 21/21, TypeScript and ESLint passed; full unit suite 798/799, with unrelated-looking `deploy-config.test.ts:157` failure not yet proven pre-existing. Scratch comparison reproduces old behavior (`[]`) vs fixed behavior (`['open']`) for 20 submitted + one open test. Browser regression remains unverified: workstation DNS currently fails, and read-only staging query found only 6 published tests (all closed), 3 drafts, 2 total submitted attempts, and no student with 20 submitted in-window tests. No staging data was written, no migrations run, and no production changes. Next: resolve workstation DNS and perform smoke checks with existing accounts; full cap regression requires separately approved test-data preparation or a suitable test environment. |
| 5 | Professional-session One-Liners need PDF support. | Not started. |
| 6 | PDFs fail or remain stuck loading. | Not started. |
| 7 | PDF reader lacks previous/next navigation. | Not started. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Tests lack block-wise sections. | Not started. Confirm the intended section structure from existing product behavior/docs before implementation. |
| 11 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |

## Current handoff

Issue 3's filter-parity fix remains **verified on staging** at `16a74f42c0af8c41552c67f10b5f5fbc9275fb3f`; all six targeted E2E scenarios passed. Its original cross-Block mixing symptom remains open/unreproduced; await a concrete example and do not impose Block purity.

**Active issue: Issue 4 — Paid dashboard hides open tests.** Fix commit `0026cad1933a22b78e28819dcd7b8f8f8cf6afd1` is deployed to staging only. Root cause was cap-before-filter ordering; the local old-vs-new comparison and focused tests support the fix. Staging health is 200 and production remains unchanged. Browser verification is blocked because workstation DNS fails and staging has no suitable test data (6 published tests, all closed; 2 total submitted attempts; no qualifying student). No data was written. Next: resolve workstation DNS and run smoke checks with existing accounts; the original regression needs a qualifying test environment or separately approved staging data preparation. Do not push app code, deploy to production, or alter shared infrastructure without explicit approval.

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
