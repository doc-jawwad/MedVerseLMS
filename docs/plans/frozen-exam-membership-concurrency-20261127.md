# Plan — frozen exam membership, publication and year-change concurrency (#38, PR39)

Status: **PLAN ONLY — PENDING_R2.** Not approved for implementation until the doc delta (D1) is approved and an independent R2 review accepts this plan. Prevention-only. Base: PR39 head `79040940950c809a7ccc38f7f8c3333160647e4c` (on PR13 `40635334cc969abbbca115b1dfb2c317d0706a17`).

Hard limits (unchanged): no change to historical exam rows, scores, attempts, answers, frozen `question_version_id`s, or the **21 existing wrong-year links across 3 tests**. No backfill or validation scan. No staging/production migration, no permission or RLS widening, no paid CI, no unrelated refactor. Disposable local PostgreSQL only.

## 1. Verified source facts (effective definitions)

| # | Fact | Source |
|---|------|--------|
| F1 | `publish_test` reads `tests.status` with a plain SELECT and takes **no row lock** until its final `update tests set status`. | `20261005010000_publish_test_validate_permission.sql` |
| F2 | Link triggers read `tests.status` / `tests.year_id` and `questions.year_id` with plain SELECTs (no lock). The year trigger (`test_questions_enforce_year_on_link`) fires **before** `test_questions_protect` (alphabetical). | `20261122213827_…` (PR13/PR39) |
| F3 | The only lock a link INSERT takes on `tests` is the FK `FOR KEY SHARE`, which does **not** conflict with publish's status UPDATE (`FOR NO KEY UPDATE`). ⇒ **attach ∥ publish race is real**: an uncommitted attach is invisible to the publish freeze/year scan; both commit; the published test holds an unfrozen (`question_version_id is null`) and possibly wrong-year link. Same for DELETE and draft→draft reparent. | PG row-lock matrix + F1/F2 |
| F4 | `sync_test_question_count` (AFTER INSERT/DELETE) already does `update tests …` on every attach/detach, so concurrent attaches to one test **already serialize on the tests row** — but only *after* the BEFORE checks ran. It does **not** fire on `UPDATE OF test_id` ⇒ draft reparent leaves both counts stale. | `20260912000017_test_question_count.sql` |
| F5 | `questions.year_id` is a denormalized copy set by `questions_sync_ancestors` only on `topic_id` change; a direct `year_id` update is also possible (RLS `edit_questions`). Upstream taxonomy edits (subject/book/chapter/topic) do **not** cascade to `questions.year_id`. No guard exists for a question's year changing while linked. | `20260912000008`, `20260912000003` |
| F6 | `tests.year_id` is frozen only when `old.status <> 'draft'` (`protect_published_test`). Draft year change with links is unchecked until publish. | `20261012090000_test_max_attempts.sql` |
| F7 | `test_questions` write RLS = `has_permission('publish_tests')` for insert/update/delete (USING old row, CHECK new row). No year scope on tests for admins today. App never reparents (`src/lib/actions/tests.ts` only inserts/updates marks/positions); reparent is reachable only by direct PostgREST. | `20260915033122_admin_permissions.sql` |
| F8 | `start_attempt`, `return_to_draft_test`, `reuse_test_as_draft`, `delete_draft_test`, close paths already lock `tests … for update`. | multiple |
| F9 | Two-session harness pattern exists: `tests/db/start-attempt-resume-race.mjs`, `start-attempt-reattempt-concurrent.mjs`, `import-question-batch-concurrent.mjs` (pg clients, `assertNotCloudProduction`, synthetic users). | `tests/db/` |

## 2. Design — one serialization point plus a fixed lock order

**Lock order (global, documented):** `tests` rows (ascending `id`) **→** `questions` rows (ascending `id`). There are no new lock types, advisory locks or isolation-level changes. The plan reuses the tests-row lock that F4 already takes, only earlier.

| Change | What | Why |
|---|---|---|
| **L1** `publish_test` | First statement: `select status into … from tests where id = p_test_id for update`; `not found or status <> 'draft'` → existing `'only draft tests can be published'`. After validation and **before** freeze: `perform 1 from questions q join test_questions tq … where tq.test_id = p_test_id order by q.id for no key update of q`. Rest unchanged (same definer, ACL, search_path, messages, audit). | Closes F3 from the publish side. Question locks make the freeze and year scan read committed years/versions, and the later `used_in_test` update needs no lock upgrade. Ordered ⇒ two publishes that share questions serialize instead of deadlocking. |
| **L2** link triggers | `enforce_test_question_year_on_link` (definer, fires first) and `protect_published_test_questions` (invoker, keep PR39 body/ACL/search_path) read the parent test(s) with `for no key update`. For a reparent, lock `{old.test_id,new.test_id}` `order by id`. Status/year are read **from the locked row**. In protect, *not found* on INSERT/UPDATE → raise `'questions of a published test are frozen'` (fail-closed against RLS filtering). *Not found* on DELETE keeps today's behaviour (cascade from `delete_draft_test`). | Closes F3 from the writer side. After waiting, READ COMMITTED re-reads the row ⇒ a writer that queued behind publish sees `published` and is rejected. Uses the same lock strength F4 already takes ⇒ no new contention and no share→update upgrade deadlock. |
| **C1** count | Extend `test_questions_sync_count` to `after insert or delete or update of test_id`. On UPDATE, recompute **both** old and new test (ascending id). | Fixes F4 reparent drift. Rows are already locked by L2. |
| **Y1** question year guard | New definer trigger `questions_zz_guard_linked_year` (name sorts **after** `questions_sync_ancestors`, so it sees the derived year): `before update on questions for each row when (new.year_id is distinct from old.year_id)`. It raises `test_question_year_mismatch` (23514) if any link exists to a test with `t.year_id = old.year_id and t.year_id is distinct from new.year_id` (all statuses). Reads tests **without** locking, so the lock order is kept. | Prevents *new* mismatches from topic moves or direct year edits, published or draft. Existing wrong-year links (`t.year_id <> old.year_id`) never trigger it ⇒ the 21 historical links stay as they are, and those questions stay editable. |
| **Y2** draft test year guard | New definer trigger on `tests`: `before update of year_id … when (old.status = 'draft' and new.year_id is distinct from old.year_id)`. It raises 23514 if any linked question has `q.year_id = old.year_id and q.year_id is distinct from new.year_id`. It runs under the test row lock that the UPDATE itself takes, so it serializes with L2 attachers. | Rejects a future mismatch at the point it would be created, instead of only at publish. |
| **B1** backstop | Keep PR13's `tests_enforce_question_year_before_publish` unchanged. With L1 it now scans committed links and locked question years. | **Authoritative** guard. The only race left unblocked at change time is question-year change ∥ draft attach (Y1 can't see an uncommitted link, and the attacher holds only FK KEY SHARE on the question). That produces at most a *draft* mismatch, which B1 then deterministically refuses to publish. |
| **A1** app UX only | `src/lib/actions/questions.ts` (question edit/move) and the test-config update map `test_question_year_mismatch` to a friendly message, reusing the existing `publish-test-errors` mapping helper. No logic. | DB is the only enforcement. |

Attempt integrity: no change to `start_attempt` or scoring. Published membership is frozen under L2+L1, and attempts already lock the test row (F8). The tests assert that attempts, answers and scores are unchanged.

Authorization (verify, **no widening**): RLS stays as F7. The plan adds tests only: anon, student and `edit_questions`-only admins cannot insert, update or delete `test_questions`. A `publish_tests` admin can reparent draft→draft only. A non-draft endpoint is rejected in both directions (PR39). L2's invoker `FOR NO KEY UPDATE` requires the tests UPDATE policy, which every legitimate `test_questions` writer already satisfies (same `publish_tests` predicate, or a definer RPC).

## 3. Migration packaging

- **New** migration `supabase/migrations/20261127120000_frozen_exam_membership_concurrency.sql`, layered on PR39. It contains only `create or replace` of `publish_test`, the two link-trigger functions and `sync_test_question_count`, plus a trigger re-create (C1) and two new triggers (Y1, Y2). The PR13/PR39 file is not edited again. That keeps PR39's reviewed delta stable and avoids any "already applied" ambiguity.
- Preserve every existing invoker/definer choice, `search_path`, volatility, `revoke … from public, anon, authenticated` on trigger functions, and the `publish_test` grants. The new functions use `set search_path = public, pg_temp`.
- No DML on existing rows. No `alter table`, no index, no validation scan.

## 4. Doc first (approval gate D1)

Before any code, append to `docs/test-rules.md` (§ Question-year consistency) and `docs/database.md` (trigger/lock inventory):
1. Membership writers and `publish_test` serialize on the `tests` row. Lock order is tests→questions, ascending id.
2. A question's `year_id` cannot change while it is linked to any test of its current year (any status). Remove it from draft tests first.
3. A draft test's `year_id` cannot change while it holds questions of its current year.
4. The publish-time guard is authoritative. A transient draft mismatch from concurrent edits cannot publish.
5. Draft reparent is draft→draft only and keeps both `question_count`s exact.

**Founder approval is needed for rules 2–3.** They are new user-visible restrictions. If they are declined, drop Y1/Y2 and rely on B1 alone. Y1 must then still be replaced by "question year frozen while linked to a non-draft test", because otherwise published history can drift with no detection.

## 5. Tests (deterministic; local disposable PG only)

**Sequential pgTAP:** extend `supabase/tests/248_test_question_year_consistency.sql` (currently `plan(10)`). Add:
- Y1: reject a move that breaks a matching draft link and one that breaks a published link. Allow the move after the question is removed from the draft. Allow non-year edits.
- Y2: reject a draft year change that breaks links. Allow it on an empty draft.
- C1: both counts are exact after a draft→draft reparent.
- Authorization matrix (anon, student, `edit_questions`-only, `publish_tests`).
- **Historical fixture:** a published test with a wrong-year link, inserted as runner with the guards temporarily disabled inside the rolled-back tx (existing 248 pattern). Assert it stays byte-identical (link, version, attempt, score rows). Its question can still get a non-year edit. A *draft* copy of it still cannot publish.

Keep 245 (58) green.

**Two-session races:** new `tests/db/frozen-exam-membership-concurrent.mjs`, cloned from the F9 harness (same env guard, synthetic users, fixture cleanup). Determinism:
- Session A opens a tx and runs step 1 without committing.
- Session B's statement is launched un-awaited.
- The runner polls `select pg_blocking_pids($B_pid) @> array[$A_pid]` until it is true (≤5 s). The case fails if B is **not** blocked where blocking is expected, or if B **is** blocked where it is not expected.
- A then commits or rolls back, B is awaited and the outcome is asserted.
- Each session sets `lock_timeout = '10s'`, so a regression cannot hang the run. Any `40P01` fails the case.

| Case | A (holds) | B (blocked?) | Expected |
|---|---|---|---|
| R1 | attach Q→X (draft) | `publish_test(X)` — blocked | commit A ⇒ B succeeds; **every** X link frozen (`question_version_id` not null); `question_count` = actual |
| R2 | `publish_test(X)` | attach to X — blocked | B fails `frozen`; X membership = pre-publish set |
| R3 | `publish_test(X)` | reparent X→Y (draft) — blocked | B fails; X membership intact; counts exact |
| R4 | `publish_test(Y)` | reparent X→Y — blocked | B fails; Y frozen set unchanged |
| R5 | delete link from X | `publish_test(X)` — blocked | commit A ⇒ B publishes the reduced set; count exact |
| R6 | question Q year change (Q in X, matching) | — | A fails immediately (Y1) |
| R7 | Q year change (Q linked nowhere) | attach Q→X — **not** blocked, passes (old year) | both commit ⇒ draft mismatch ⇒ `publish_test(X)` fails 23514 and rolls back (B1). This documents the accepted residual |
| R8 | `publish_test(X)` | Q year change, Q∈X — blocked | B fails Y1 |
| R9 | Q (a draft-mismatched member of X, from R7) moved **to** X's year (Y1 allows it) | `publish_test(X)` — blocked on Q's row (L1) | commit A ⇒ B re-reads Q and publishes; variant: rollback A ⇒ B fails 23514. This proves publish reads the locked, committed year |
| R10 | draft X year change | attach to X — blocked | B fails 23514 (year read from the locked row) |
| R11 | reparent X→Y (draft) | insert into Y — blocked | both counts exact |
| R12 | `publish_test(X)` | `publish_test(Z)` sharing Q — blocked | both succeed, no deadlock |
| R13 | `start_attempt` on published X | attach/delete/reparent on X | all rejected; attempt/answer/score rows hash-identical before vs after |

Release gates (all required, none authorized by this plan):
1. D1 approved.
2. 248 + 245 + the race script pass on a fresh disposable clone, with a rollback-baseline check.
3. Full `npm run test:db` pass on disposable PG.
4. Independent R2 review of the implementation diff.
5. Separate explicit approval for any staging or production apply.

## 6. Implementation wave (single Sonnet wave, ordered)

1. Docs D1 (after approval).
2. Migration (L1, L2, C1, Y1, Y2).
3. pgTAP 248 extension.
4. Race script R1–R13.
5. A1 error mapping and its unit test in `tests/unit/publish-test-errors.test.ts`.
6. Local disposable run: record exact counts. Commit, non-force push, checkpoint. Review stays **PENDING_R2**.

Out of scope: repairing the 21 links, any attempt/score recompute, admin year-scoped RLS for tests, the `used_in_test` semantics, changes to `reorder_test_question` (already safe under L2: same test row).
