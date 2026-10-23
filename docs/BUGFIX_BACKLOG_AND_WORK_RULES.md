# MedVerse LMS — Reported Bug Backlog and Work Rules

Last updated: 2026-10-23

Latest Issue 3 investigation: Cursor reported PARTIAL on 2026-10-23; no reproducible cross-Block mixing defect was established and no files were changed. Potential gaps: no server-side Block-purity validation for test contents; product currently allows Mixed tests and combining sources, so Block purity is not an approved invariant. A separate documented mismatch was identified: random-add ignores the visible pool's `q` text-search and `import_batch` filters although `docs/test-rules.md:107` says both share the same filter. Next: focus on verifying/fixing this documented filter mismatch with regression tests; do not impose Block purity without an approved requirement.

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
| 3 | Questions/tests are mixed across blocks. | **Investigating — partial findings, no confirmed cross-Block defect.** Cursor found no reproduction and changed nothing. Block-purity is not established as a product rule; Mixed tests and combined question sources are currently allowed. Concrete adjacent mismatch: `addRandomQuestions` reportedly ignores the visible pool's `q` and `import_batch` filters, despite `docs/test-rules.md:107` requiring shared filters. Next: verify this narrow documented mismatch and add regression coverage if confirmed; do not enforce Block purity without an approved requirement. |
| 4 | Paid dashboard hides open tests. | Not started. |
| 5 | Professional-session One-Liners need PDF support. | Not started. |
| 6 | PDFs fail or remain stuck loading. | Not started. |
| 7 | PDF reader lacks previous/next navigation. | Not started. |
| 8 | Professional-session content loads slowly. | Not started. Measure and identify the bottleneck before optimizing; preserve behavior and permissions. |
| 9 | Samsung / non-Chrome browser problems. | Not started. Identify affected browser/device behavior and reproduce before fixing. |
| 10 | Tests lack block-wise sections. | Not started. Confirm the intended section structure from existing product behavior/docs before implementation. |
| 11 | Linking content defaults to the wrong subject (Medicine). | Not started. Trace subject selection/defaulting and preserve valid existing mappings. |

## Current handoff

The active task remains **Issue 3**. Initial read-only investigation found no reproducible cross-Block mixing and no approved rule requiring Block-pure tests. Continue narrowly by verifying the documented random-add filter mismatch (`q` and `import_batch`) against the visible pool and `docs/test-rules.md:107`; if confirmed, implement only that focused correction with regression tests. Do not modify schema/data or impose Block purity. Issue 2 is unconfirmed and inactive.

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
