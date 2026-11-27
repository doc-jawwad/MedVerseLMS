# #38 frozen exam membership — local disposable implementation evidence (2026-11-27)

**Scope:** implementation of the accepted plan r3 (`docs/plans/frozen-exam-membership-concurrency-20261127.md`, `f8dc24a`; D1 approved; plan accepted in #38 comment 7205436435). **Local disposable synthetic PostgreSQL only.** This record is **not** a staging or production sign-off and authorizes no deployment. Review status: **PENDING_R2** (independent implementation review).

## Environment

- **Database:** a task-owned copy of the stopped synthetic R1 QA volume (`supabase_db_medverse_r1_accept_299c603`, source mounted read-only and left untouched).
  - Container: `public.ecr.aws/supabase/postgres:17.11.0.018`, 512 MiB, bound to `127.0.0.1:54399` only.
  - Baseline: migration `20261025160000`; 5 synthetic tests, 0 links, 0 attempts.
  - PR39's `20261122213827` applied first, giving the **PR39 baseline**.
- **Negative-control clone:** a second throwaway copy (`127.0.0.1:54398`). It was removed after use.
- **Data:** synthetic only, built from PGTAP-style curriculum, fixture questions and synthetic admins/students. No real user, exam or attempt rows were read or written.

## Synthetic history fixture (stands in for the 21 links / 3 tests)

The history fixture was created by `tests/db/frozen-exam-membership-concurrent.mjs history-create` on the PR39 baseline. It used the realistic pre-guard path, with **no trigger toggles**:
1. Publish 3 tests × 7 same-year questions via `publish_test`.
2. Have 2 synthetic students each start, answer and submit an attempt per test.
3. Move the 21 questions to a year-2 topic.
4. Settle ranking synchronously.

**Result:** 21 wrong-year links, 6 attempts, 42 answers. Fixture test ids and link ids are recorded in the run's `history.json`.

Hash coverage: every test that was non-draft when the fixture was created (8 tests), plus their `test_questions`, `test_attempts`, `attempt_answers` and `ranked_test_attempts`.

| Point | tests | test_questions | test_attempts | attempt_answers | ranked | wrong-year ids |
|---|---|---|---|---|---|---|
| pre-migration | 8:`1d98c0d1…2240` | 21:`de761c7f…f5a6` | 6:`607f6ade…3336` | 42:`b937d200…e968` | 6:`607f6ade…3336` | 21, identical |
| post-migration | identical | identical | identical | identical | identical | 21, identical |
| post full suite | identical | identical | identical | identical | identical | 21, identical |

Note on the first attempt: the clone's `medverse-auto-submit` cron calls `rank_dirty_tests()`, which wrote rank/percentile onto freshly submitted fixture attempts *after* the first pre-hash. That run was discarded and the clone rebuilt. History creation now settles ranking before hashing, and the pre-hash was verified stable across a full cron cycle.

## Reproduction on the PR39 baseline (before this migration)

`node tests/db/frozen-exam-membership-concurrent.mjs` ended with **184 passed, 65 failed**. Failing cases: R1, R2, R4, R6, R8, R9, R10, R11, R13, R14-NC, R20, R21, R23, R24, R25, R27 and S1–S6.

Each was reproduced with real lock barriers:
- a published test with an **unfrozen** link (R1, R2, R24, R25);
- a reparent **into** a published test (R4);
- a published **wrong-year** link (R8, R23 direct and RPC);
- stale validation publishing an **unapproved** or **soft-deleted** question, or freezing an **old version** (R20);
- direct `published → draft` with a live attempt (R21);
- direct publish with no freeze, a mixed status+config update, a non-draft insert and direct draft→closed (S1–S4);
- reparent count drift (R11, S5);
- a question move breaking a published link (S6).

The extended `248` on a PR39-baseline clone fails 32/59. Every Y1/Y2/C1/G0–G3/isolation assertion fails. The remaining failures cascade from those guard-less statements succeeding, for example the `empty` draft really becoming `invalidated`, so #50 fails as "frozen" rather than on RLS.

## After `20261127120000_frozen_exam_membership_concurrency.sql`

- **Effective objects verified:**
  - Trigger order: tests `…_protect_published, …_updated_at, tests_zz_guard_draft_year, tests_zz_guard_initial_status, tests_zz_guard_status_transition`; questions `questions_sync_ancestors < questions_zz_guard_linked_year`.
  - ACLs: existing functions keep their exact prior ACL, definer setting and `search_path`. `private_lock_test_links` is `postgres` only. The new trigger functions are `postgres` + `service_role`, the same pattern as the PR13 trigger functions.
- **Race suite:** **249 passed, 0 failed**, three consecutive runs. R25 (X3 residual) landed in class (i) "publish then reject" 20/20 each run; the deadlock branch was never observed. R14-NC (the r1 ordering negative control, under real barriers) produces the pinned 40P01. R16 (X1 residual) produces the pinned 40P01 with full victim rollback.
- **pgTAP `248`:** 59/59. **`245`:** 58/58.
- **Full `run-pgtap.mjs`:** 1669 `ok`, 22 failures. That failure set is **identical** to the PR39 baseline (1620 `ok`, 22 failures, the same lines). The +49 is the extended 248.

Pre-existing failing files, unchanged by this change: 010_rls (1), 100_admin_permissions (4), 161_8jb_own_test_result (1), 165 (1), 166 (3), 168 (1), 171 (3), 207 (1), 212 (1), 220 (1), 231 (1), 233 (1), 234 (1), 235 (1), 247 (1).

**Fixture compatibility:** 9 older pgTAP files built non-draft tests directly: 141, 150, 151, 152, 161, 180, 236, 244, 247. One more than §5.1 listed, as anticipated there. They now call `test_helpers.allow_direct_test_status()` once after `plan()`. This rollback-scoped, fixture-only helper disables the two lifecycle triggers inside that file's transaction. It is not used by 248 or the race script. The e2e specs `test-draft-manage` and `test-draft-complete-edit` now publish their sibling via the `publish_test` RPC, using a separate one-question pool.

## App, unit and static checks

- `node --test tests/unit/publish-test-errors.test.ts`: 8/8.
- Full `npm run test:unit`: 827/828. The one failure, `deploy-config.test.ts` "HTTP auto-submit fail-closes when CRON_SECRET is unset", also fails at the PR39 head with this change stashed.
- `tsc --noEmit`: one error, `src/app/layout.tsx` `LayoutProps`. This is a Next-generated type missing in a worktree without `.next`, and it is identical at the PR39 head.
- ESLint on all changed TS/JS files: clean.
- **Not run:** Playwright e2e (no local app/Auth stack in this run), staging, production.

## Residuals (accepted design, unchanged)

X1–X4 per plan §2.3 are abort-safe. X1 is proven by R16. X3 is exercised by R25 but was never observed deadlocking. X2 and X4 are documented only.

## Addendum — R2 implementation review corrections (#38 comment 7206144469)

The correction commit `6ecc2e2` (migration `20261127121000_frozen_exam_reorder_insert_guard.sql`, race cases R28–R31) was verified on a fresh disposable clone of the same synthetic R1 source. Verification also added three sequential 248 assertions.

**Clone sequence:**
1. PR39 baseline.
2. New synthetic history fixture: 3 tests, 21 wrong-year links, 6 attempts, 42 answers. Pre-hash `tests 8:4628bad9…9c3f`, `test_questions 21:58b41533…9c06`, `test_attempts 6:7f5a8acd…372d`, `attempt_answers 42:a76cd779…7d1a`.
3. `20261127120000` only, which is the `1fedec3` state.
4. `20261127121000`.

**Reproduced on the `1fedec3` state, with real lock barriers:**
- **Finding 1 (reorder):**
  - R28: after a concurrent draft reparent, `reorder_test_question` rewrote the moved link inside the *other* draft (position 9 → 1) and set the source link to 9.
  - R29: a concurrent neighbor delete led to a NULL-position write (23502).
  - R30: competing reorders used stale adjacency and produced the wrong order.
- **Finding 2 (unauthorized direct insert):**
  - R31: a student or `edit_questions`-only admin *waited* on a locked parent, and a wrong-year insert returned `test_question_year_mismatch` (23514) instead of 42501.
  - 248 #51 and #55 show the same year oracle sequentially.
  - 248 #52 shows an additional frozen-state oracle: an unauthorized attach to a published test returned `questions of a published test are frozen` instead of 42501.

**After `20261127121000`:**
- Race suite: 284/284 on three consecutive runs (R1–R31, R14-NC, S1–S6). R25 again landed in class (i) 20/20.
- 248: 62/62. 245: 58/58.
- Full pgTAP: 1672 `ok`, 22 failures, a set identical to the PR39 baseline.
- History: hash-identical after both migrations and after the full suite.
- ACLs:
  - `reorder_test_question` ACL is unchanged.
  - `require_test_question_insert_permission` is invoker with EXECUTE for `postgres` only. As a trigger function it is not callable through the API.
- Trigger order: `test_questions_aa_require_insert_permission` < `…_enforce_year_on_link` < `…_protect` < `…_sync_count`.

**Wording correction:** R21 rejects on either G2 precondition. The schedule check fires first for an opened test. It therefore proves that a direct published → draft flip serializes behind `start_attempt` and is rejected. It does **not** isolate the attempt-count check under concurrency. That check is proven sequentially by 248 ("G2: direct draft flip of a test with attempts is rejected").

Still not run: Playwright e2e, staging, production. Pre-existing unit (`deploy-config`) and `tsc` (`LayoutProps`) failures are unchanged, and no app code changed in this delta.
