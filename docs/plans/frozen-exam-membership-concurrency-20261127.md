# Plan — frozen exam membership, publication and year-change concurrency (#38, PR39)

Status: **PLAN ONLY — PENDING_R2.** Revision **r3** (amends r2 `1ff92ed`, which amended r1 `2dc24bb`). r2 responded to the R2 plan review (#38 comment 7204897998). r3 applies the focused guard correction (#38 comment 7205182335) and adds no redesign. Implementation needs two things first: D1 founder approval (§4) and R2 acceptance of this revision. Prevention-only. Base: PR39 `79040940950c809a7ccc38f7f8c3333160647e4c` on PR13 `40635334cc969abbbca115b1dfb2c317d0706a17`.

Hard limits (unchanged):
- No change to historical exam rows, scores, attempts, answers, frozen `question_version_id`s, or the **21 existing wrong-year links across 3 tests**.
- No backfill, no validation scan, no DML on existing rows.
- No staging or production migration.
- No permission, RLS, grant or role change, either widening or narrowing.
- No paid CI and no unrelated refactor. Disposable local PostgreSQL only.

## r2 change log (review → resolution)

| Review finding | r1 problem | r2 resolution |
|---|---|---|
| Parent/child lock-order inversion | r1 had publish lock the `tests` row first and then UPDATE child links. A direct UPDATE/DELETE on `test_questions` locks the **child tuple before** its BEFORE ROW trigger runs, and the trigger then waits on the parent. The two cycle. | §2 adopts a **child-first protocol**: links → test → questions. Every RPC that writes a test's links locks them child-first, in ascending `id` (L0–L4). The remaining multi-statement residuals are scoped as abort-safe in §2.3. |
| Per-row parent sort ≠ tx-wide order | Sorting `{old,new}` parents inside one row's trigger does not order a whole statement or transaction. | §2.3 separates two cases. Per-row parent ordering is kept only where it is enough: a single-row reparent, where the only child is already held. Multi-row and multi-statement direct writes are scoped as abort-safe and proven by tests (R14–R16). `reorder_test_question` (the one multi-row RPC) is made id-ordered (L4). |
| Lock questions before validation | r1 locked questions after `validate_test`, so approval, deletion and version checks could go stale. | L1 locks member questions **before** `validate_test`, and `require_permission('publish_tests')` stays the first statement, before any lock. |
| Direct status publication bypass | Not addressed. RLS `tests_admin_update` lets a `publish_tests` admin `update tests set status='published'` directly. That skips `validate_test` and the freeze; only PR13's year trigger runs. A direct `published → draft` also skips `return_to_draft_test`'s no-attempts/unopened checks and unfreezes the membership. | **G1/G2** (§2.2): stateless status-transition triggers. They re-check the RPC preconditions inside every transition into `published` or `draft`, by any path. They change no grants. |
| Race coverage | Not covered. | §5 adds R14–R22: publish-first vs existing-link UPDATE/DELETE in both orders, multi-row opposite order, concurrent question-state change, and the direct-status bypass. Each one waits on `pg_blocking_pids`, and the deadlock victim is pinned. |

## r3 change log (focused guard correction → resolution)

| Finding | Resolution (reuses r2; no redesign) |
|---|---|
| G1 calls `validate_test(new.id)`, which reads the **persisted OLD** row. `protect_published_test` freezes config only when `old.status <> 'draft'`. So a combined `status + min_questions/duration/opens_at/…` UPDATE would validate old values and publish new ones. | **Reject mixed updates** (the preferred option, matching the app RPCs, which change only `status`, plus `updated_at` or `closes_at`). The guard is one trigger, renamed `tests_zz_guard_status_transition` so it sorts **last** and sees the final NEW. On any status change into `published` or `draft`, it raises `test_status_change_must_be_isolated` (23514) if `to_jsonb(new) - '{status,updated_at}'` differs from `to_jsonb(old) - '{status,updated_at}'`. Then `validate_test` and the year checks run against exactly the persisted config being published. |
| PR13's `tests_enforce_question_year_before_publish` sorts first and reads question years **unlocked**. | G1 **re-runs the year predicate after** taking the ordered question locks (step b′ below). PR13's trigger stays as-is: harmless, and fail-safe if stale. |
| Non-draft initial INSERT: `tests_admin_insert` allows any status. G1/G2 only covered UPDATE. | **G0**: `before insert on tests`. `new.status <> 'draft'` raises `tests_must_be_created_as_draft` (23514). Verified routes: app `createTest`, `reuse_test_as_draft` and the pgTAP `make_published_test` all insert `draft`. |
| Effective lifecycle routes. | RPC graph: draft→published (`publish_test`), published→draft (`return_to_draft_test`), published→closed (`close_test_now`), published/closed→invalidated (`invalidate_test`). **G3**: a draft may leave `draft` only to `published`, so a direct draft→closed/archived/invalidated is rejected with `only draft tests can be published`. All RPC transitions are preserved. Other non-draft↔non-draft transitions are not membership-mutating and are out of scope. |
| Over-claim of cycle-freedom. | §2.3 now says **"designed cycle-free; claimed only after R-suite pass"**. |
| Untested second L0, residuals and the L3 window. | R23–R27 added. `delete_draft_test` also gets the second L0 (L3′). R7's expected draft mismatch is separated from the post-case invariants (§5). |
| Existing fixtures that depend on direct status flips. | §5.1 fixture-compatibility list, with test-only remediation. |

## 1. Verified source facts (effective definitions)

| # | Fact | Source |
|---|------|--------|
| F1 | `publish_test` reads `tests.status` with a plain SELECT, validates, and then freezes. It takes no row lock until its status UPDATE. | `20261005010000_publish_test_validate_permission.sql` |
| F2 | The link triggers read `tests.status`, `tests.year_id` and `questions.year_id` without locks. `test_questions_enforce_year_on_link` (definer) fires before `test_questions_protect` (invoker). | `20261122213827_…` |
| F3 | A link INSERT only holds the FK `KEY SHARE` on `tests`, which doesn't conflict with publish's status UPDATE. So attach, delete or reparent racing publish can leave an unfrozen or wrong-year link on a published test. | PG lock matrix + F1/F2 |
| F4 | `sync_test_question_count` (AFTER INSERT/DELETE) updates the `tests` row on each attach/detach. It does not fire on `UPDATE OF test_id`, so a reparent leaves both counts stale. | `20260912000017` |
| F5 | `questions.year_id` is denormalized. `questions_sync_ancestors` sets it on a `topic_id` change, and a direct update is also possible. Upstream taxonomy edits do not cascade. | `20260912000008`, `20260912000003` |
| F6 | `tests.year_id` is frozen only when `old.status <> 'draft'`. App `updateTestConfig` allows `year_id` but not `status` (`src/lib/tests/test-config-update.ts`). | `20261012090000`, src |
| F7 | `test_questions` and `tests` write RLS is `has_permission('publish_tests')`. There is **no status-transition guard** on `tests`: the only status trigger is PR13's year check. Every app status change uses an RPC: `publish_test`, `return_to_draft_test`, `close_test_now`, `invalidate_test`, `delete_draft_test`, `reuse_test_as_draft`. | `20260915033122`, src grep |
| F8 | Child-tuple-first writers: direct PostgREST UPDATE/DELETE, `void_test_question` (one row), app `setQuestionMarks` and remove (one row), and `reorder_test_question` (two rows, arbitrary order). Parent-then-child writers: `return_to_draft_test` (`tests for update`, then UPDATE links), `delete_draft_test` (`tests for update`, then cascade DELETE links). Parent-only: `close_test_now`, `invalidate_test`, `start_attempt*`. | migrations |
| F9 | In READ COMMITTED, a BEFORE ROW UPDATE/DELETE trigger runs **after** the executor has locked the target tuple. A BEFORE ROW INSERT trigger runs before the tuple exists. | PG trigger semantics; confirmed by R14/R15 negative controls |
| F10 | Two-session harness: `tests/db/start-attempt-resume-race.mjs` and siblings (pg clients, `assertNotCloudProduction`, synthetic users). The runner connects as superuser, so it can `SET deadlock_timeout` per session before `set role authenticated`. | `tests/db/` |

## 2. Design

### 2.1 Lock protocol (documented in `docs/database.md`)

**Order: a test's `test_questions` rows (ascending `tq.id`) → the `tests` row → `questions` rows (ascending `q.id`).** It uses only existing PG row locks: no advisory locks, no isolation-level changes.

Why child-first: F9 forces direct UPDATE/DELETE writers to hold their child before any trigger can act. Putting every other path in the same order means **single-row direct writers, multi-row INSERTs and all RPCs never form a cycle**.

| Change | Definition |
|---|---|
| **L0** helper | `private_lock_test_links(p_test_id uuid)`: definer, `search_path = public, pg_temp`. Body: `perform 1 from test_questions where test_id = p_test_id order by id for no key update`. **Revoked from public, anon, authenticated and service_role.** Only owner-run definer functions and triggers call it, so no new callable surface. |
| **L1** `publish_test` | Steps, in order: (1) `require_permission('publish_tests')`, unchanged and first; (2) L0; (3) `select … from tests where id = p for update`, where not found or not `draft` gives the existing `'only draft tests can be published'`; (4) L0 again, to pick up rows inserted and committed between (2) and (3), whose inserters held the test row; (5) `perform 1 from questions q join test_questions tq … order by q.id for no key update of q`; (6) `validate_test` (existing loop and messages); (7) freeze, status, `used_in_test`, audit, unchanged. Same definer, ACL, `search_path` and error contract. |
| **L2** link triggers | Both triggers read the parent row(s) `for no key update`. For a reparent, `{old,new}` are locked `order by id`; the only child involved is already held, so the order is total for that row. Status and year are read **from the locked row**. In `protect`, not-found on INSERT/UPDATE raises `'questions of a published test are frozen'` (fail-closed). Not-found on DELETE keeps current behaviour (cascade from `delete_draft_test`). PR39's invoker, ACL and `search_path` are preserved. |
| **L3** parent-first RPCs | `return_to_draft_test` and `delete_draft_test` insert L0 **after** `require_permission` and **before** their existing `tests … for update`. All other logic and messages stay unchanged. **L3′**: `delete_draft_test` repeats L0 after its `tests` lock, the same pattern as L1 step 4, to cover links inserted in between. `return_to_draft_test` needs no repeat, because its source test is published and can't gain links. |
| **L4** `reorder_test_question` | After locating `v_a` and `v_b`, run `perform 1 from test_questions where id in (v_a.id, v_b.id) order by id for no key update`, then the existing two UPDATEs. |
| **C1** count | `test_questions_sync_count` becomes `after insert or delete or update of test_id`. On UPDATE it recomputes both tests (rows already locked by L2). |

### 2.2 Year and status guards

| Change | Definition |
|---|---|
| **Y1** question year | Definer trigger `questions_zz_guard_linked_year`, named so it sorts after `questions_sync_ancestors`. `before update … when (new.year_id is distinct from old.year_id)`. Raises `test_question_year_mismatch` (23514) if a link exists to a test with `t.year_id = old.year_id and t.year_id is distinct from new.year_id` (any status). It holds only the question row and reads tests unlocked, so the protocol is kept. Historical wrong-year links never match, so the 21 links and their questions are unaffected. |
| **Y2** draft test year | Definer trigger: `before update of year_id on tests … when (old.status = 'draft' and new.year_id is distinct from old.year_id)`. Raises 23514 if any linked question has `q.year_id = old.year_id and q.year_id is distinct from new.year_id`. It runs under the test-row lock taken by the UPDATE, with no child locks: link writers that queued on the test row have not yet applied anything. |
| **G0** insert | Definer trigger `tests_zz_guard_initial_status`: `before insert on tests`. `new.status <> 'draft'` raises `tests_must_be_created_as_draft` (23514). |
| **G1** → `published` | Branch of the single definer trigger `tests_zz_guard_status_transition`: `before update of status on tests`, sorting after every existing tests trigger, so it sees the final NEW. It applies when `new.status = 'published' and old.status is distinct from 'published'`. Under the test-row lock (held for every caller): (0) **isolation**: any column other than `status`/`updated_at` differing between NEW and OLD raises `test_status_change_must_be_isolated`; (a) `old.status` must be `draft`, else `'only draft tests can be published'`; (b) lock member questions `order by q.id for no key update` (a no-op re-lock inside `publish_test`); (b′) **post-lock year re-check**: any link with `q.year_id is distinct from new.year_id` raises `test_question_year_mismatch` (23514); (c) every link has `question_version_id is not null`, `qv.question_id = tq.question_id` and `= q.current_version_id`, else `'validation failed: question versions freeze'`; (d) every `validate_test(new.id)` item passes, else `'validation failed: <check>'`. A direct status flip without the RPC's freeze fails (c). A hand-frozen direct flip still has to pass (d) with the current snapshot. Either way, no bypass of validation or freeze is possible. |
| **G3** draft exit | Same trigger: `old.status = 'draft' and new.status not in ('draft','published')` raises `'only draft tests can be published'`. |
| **G2** → `draft` | Same trigger: `when (new.status = 'draft' and old.status is distinct from 'draft')`. First the isolation check (0) as in G1, then it applies `return_to_draft_test`'s own preconditions verbatim: `old.status = 'published'`, `opens_at > now()`, and zero `test_attempts`, using the existing error strings. It serializes with `start_attempt`, which locks the test row `for update` (F8). |
| **B1** | PR13's `tests_enforce_question_year_before_publish` stays unchanged. It is the authoritative year backstop. |
| **A1** UX only | Map `test_question_year_mismatch` in the question edit/move and test-config actions, and map `40P01` to "Another change to this test was in progress — please retry", using the existing `publish-test-errors` helper. No logic change. |

G0–G3 check invariants, not caller identity, so they cannot be spoofed and need no GUC or grant change. Like all triggers, they also apply to the superuser and service role, so §5.1 lists the fixtures that must stop flipping status directly. Existing RPC bodies meet the isolation rule unchanged: `publish_test` sets only `status`, and `return_to_draft_test` sets `status` and `updated_at`; `close_test_now` and `invalidate_test` aren't in the G1/G2 branches. The implementation re-greps every `update public.tests … status` to confirm this. `validate_test` inside G1 runs its existing `require_permission('publish_tests')`. Every legitimate caller already holds that permission (RLS), so this adds nothing. The plan does not cover other transitions (`closed`, `archived`, `invalidated`), which are not membership-mutating.

### 2.3 Deadlock analysis and scoped residuals

These paths are **designed to be cycle-free**. This is a design claim only: it is **not** claimed as fact until R1–R27 pass on a disposable clone.
- Every RPC: `publish_test`, `return_to_draft_test`, `delete_draft_test`, `reorder_test_question`, `void_test_question`, `start_attempt*`, `close_test_now`, `invalidate_test`.
- Every app write: single-row UPDATE/DELETE, single- or multi-row INSERT, config UPDATE.
- Single-row reparent.
- Question writers (Y1, approval, soft delete, new version), which hold only question rows and never wait on tests or links.

`R1`–`R13` and `R17`–`R22` assert **no 40P01** on these paths.

**Accepted residuals.** All of these are abort-safe: PostgreSQL detects the cycle and rolls back one whole transaction.

| Residual | Reachable only by |
|---|---|
| X1. A direct multi-row or multi-statement UPDATE/DELETE that touches one test's links out of ascending-`id` order, concurrent with an L0 holder. | A hand-written PostgREST call or SQL session. The app never issues one. |
| X2. A direct multi-row write that spans two tests, concurrent with another such write in the opposite order. | Same as X1. |
| X3. Three concurrent operations: a draft insert commits between L1 steps (2) and (3), or between L3/L3′ in `delete_draft_test`, and a second direct writer grabs that new row before the repeated L0. | A rare three-way overlap. |
| X4. Questions locked in an unspecified scan order by existing bulk MCQ RPCs (`for update of q` over `= any(v_ids)`) against L1(5). | Pre-existing pattern. It is not modified here, to keep scope. |

**Why no invariant is lost in X1–X4:**
1. Every completing transaction has made its status, year and validation decision on locked rows, re-read after any wait.
2. A deadlock victim is rolled back in full. Publication is one transaction, so there is no partial freeze or partial publish.
3. Neither side of a cycle can commit before the other aborts.

Removing X1–X2 entirely would require revoking direct `test_questions`/`tests` DML in favour of RPCs. That is an **access change**, which the plan excludes; it can be offered later as a separate founder decision.

Attempt integrity: `start_attempt` and scoring are unchanged. Published membership is frozen under L1/L2/G1/G2, and R13/R21 assert that attempt, answer and score rows are hash-identical.

Authorization (verify only, no change): the R-suite and pgTAP matrix confirm the following. Anon, students and `edit_questions`-only admins cannot write `test_questions` or `tests.status`. `publish_tests` admins can reparent draft→draft only. Every RPC still raises its permission error **before** taking any lock: a role without the permission, calling while a lock is held elsewhere, returns the permission error without blocking (R22).

## 3. Migration packaging

- **New** migration `supabase/migrations/20261127120000_frozen_exam_membership_concurrency.sql`, layered on PR39. It contains:
  - L0 (new, revoked);
  - `create or replace` of `publish_test`, `return_to_draft_test`, `delete_draft_test`, `reorder_test_question`, both link-trigger functions and `sync_test_question_count`, each starting from the **effective** current body;
  - a re-create of the count trigger (C1);
  - the new Y1, Y2, G0 and G1/G2/G3 triggers (`tests_zz_guard_initial_status`, `tests_zz_guard_status_transition`).
- The PR13/PR39 file is not edited again.
- Preserved: every existing invoker/definer choice, `search_path`, volatility, grant and revoke, and error string. New functions use `set search_path = public, pg_temp` and `revoke all … from public, anon, authenticated`.
- No DML, no `alter table`, no index, no scan.

## 4. Doc first (approval gate D1, still pending)

Before code, `docs/test-rules.md` (§ Question-year consistency, § Publish = snapshot) and `docs/database.md` (lock and trigger inventory) gain these rules:
1. The child-first lock protocol (§2.1), with residuals X1–X4 being abort-and-retry only.
2. A question's `year_id` cannot change while it is linked to any test of its current year. Remove it from draft tests first.
3. A draft test's `year_id` cannot change while it holds questions of its current year.
4. Whatever the call path:
   - tests are created as `draft`;
   - a draft leaves `draft` only by publication;
   - a change into `published` or `draft` must change nothing but the status;
   - a change into `published` must satisfy full validation, the year check (re-run after locks) and a current-version freeze;
   - a change into `draft` must satisfy the return-to-draft preconditions.
5. Draft reparent is draft→draft only, and both counts stay exact.

Rules 2–3 are new user-visible restrictions; the reviewer recommends approving them. Rule 4 codifies what the RPCs already promise. **Founder approval is pending.** If rules 2–3 are declined, drop Y2 and narrow Y1 to "question year frozen while linked to a non-draft test".

## 5. Tests (deterministic; local disposable PG only)

**pgTAP:** extend `supabase/tests/248_test_question_year_consistency.sql` (currently `plan(10)`):
- Y1/Y2 accept and reject cases.
- C1 reparent counts.
- **G1:** a direct `status='published'` on an unfrozen draft fails freeze; a wrong-version hand freeze fails; an unapproved or soft-deleted member fails validation; the RPC publish still passes.
- **G2:** a direct `published→draft` with attempts, or once opened, fails; the RPC path is unchanged.
- The authorization matrix.
- A historical wrong-year fixture that stays byte-identical and remains editable for non-year fields, plus a draft copy of it that cannot publish.

**r3 additions to 248.** These run as **authenticated** roles via `test_helpers.as_user`, not as runner:
- A `publish_tests` admin's direct `update tests set status='published', min_questions = …`, and likewise with `duration_minutes` or `opens_at`, raises `test_status_change_must_be_isolated`. The persisted row is unchanged.
- The same applies to a mixed `status='draft' + …` update on a published test.
- A direct `insert … status in ('published','closed','archived','invalidated')` raises `tests_must_be_created_as_draft`. A `draft` insert passes.
- A direct draft → `closed`, `archived` or `invalidated` is rejected (G3).
- Each RPC (`publish_test`, `return_to_draft_test`, `close_test_now`, `invalidate_test`, `reuse_test_as_draft`, `delete_draft_test`) still succeeds on its valid fixture with an unchanged error contract on its invalid fixture.
- `edit_questions`-only admins, students and anon get their existing permission errors.

**Unchanged-history assertions** (248 and race script):
- Before the migration is applied to the clone, record a sha256 of every pre-existing `tests` row with a status other than draft, plus its `test_questions`, `test_attempts`, answer, score and ranking rows. After the migration and after the full suite, the hash must be identical and the counts equal.
- This includes the 21 wrong-year links (3 tests), checked by id list, not only by count.

`245` (58 assertions) must stay green.

**Races:** new `tests/db/frozen-exam-membership-concurrent.mjs`, cloned from the F10 harness.

Determinism protocol:
- A runs its step without committing.
- B's statement is launched un-awaited.
- The runner polls `pg_blocking_pids(B) @> {A}` and fails if B is not blocked where blocking is expected, or is blocked where it is not.
- A commits or rolls back, and B is awaited.

Every session sets `lock_timeout = '10s'`. For deadlock cases, A sets `deadlock_timeout = '50ms'` and B sets `'10s'`, which pins A as the victim. After every case, the runner asserts:
- every link of every published fixture has a frozen version equal to its question's version at publish;
- `question_count` equals the actual count;
- `tests.year_id` equals `questions.year_id` for all new links on **published** fixtures;
- the losing transaction left nothing behind.

Draft mismatches are not part of the invariant. The only case expected to produce one is R7. R7 asserts that mismatch explicitly, and that its publish attempt fails, separately from the post-case invariant. Any other case that leaves a draft mismatch fails.

| Case | A (holds) | B | Expected |
|---|---|---|---|
| R1 | attach Q→X | `publish_test(X)`, blocked on the test row | commit A ⇒ B publishes; all links frozen, count exact |
| R2 | `publish_test(X)` | attach to X, blocked | B fails `frozen`; membership unchanged |
| R3 | `publish_test(X)` | reparent X→Y, blocked on the child | B fails; X intact; counts exact; **no 40P01** |
| R4 | `publish_test(Y)` | reparent X→Y, blocked on Y | B fails; Y set unchanged |
| R5 | delete a link from X | `publish_test(X)`, blocked on the child (L0) | commit A ⇒ B publishes the reduced set; **no 40P01** |
| R6 | Q year change, Q∈X matching | — | A fails at once (Y1) |
| R7 | Q year change, Q unlinked | attach Q→X, **not** blocked | both commit ⇒ draft mismatch ⇒ `publish_test(X)` fails 23514 (B1); the documented residual |
| R8 | `publish_test(X)` | Q year change, Q∈X, blocked on Q | B fails (Y1) |
| R9 | Q (a mismatched member of X from R7) moved **to** X's year | `publish_test(X)`, blocked on Q (L1 step 5) | commit A ⇒ B publishes; rollback A ⇒ B fails 23514 |
| R10 | draft X year change | attach to X, blocked | B fails 23514 |
| R11 | reparent X→Y | insert into Y, blocked | counts exact |
| R12 | `publish_test(X)` | `publish_test(Z)`, sharing Q, blocked | both succeed; no 40P01 |
| R13 | attempt started on published X | attach, delete or reparent on X | all rejected; attempt, answer and score rows hash-identical |
| **R14** | `publish_test(X)` (holds links and test) | direct UPDATE of an **existing** X link's marks, then DELETE of another, blocked on the child | B fails `frozen` / `only voiding…` after A commits; no 40P01. **Negative control:** running the r1 design (publish locks the test first) on the same fixture must deadlock |
| **R15** | direct UPDATE of an existing X link (holds the child, then the test via L2) | `publish_test(X)`, blocked in L0 | commit A ⇒ B publishes, freezing the updated row; rollback A ⇒ same, with the original row; **no 40P01** |
| **R16** | one tx: UPDATE link `hi`, then (after B blocks) UPDATE link `lo` on X | `publish_test(X)`, holding `lo` and blocked on `hi` | X1 residual: exactly A gets 40P01 (pinned) and is fully rolled back; B publishes; invariants hold |
| **R17** | `reorder_test_question(X, …)` | `publish_test(X)`, blocked | serialized; no 40P01; frozen positions match the post-reorder order |
| **R18** | `return_to_draft_test(X)` (L3) | direct UPDATE of a link's marks on X, blocked on the child | A commits ⇒ B succeeds on the draft; reverse order is also serialized; no 40P01 |
| **R19** | `delete_draft_test(X)` (L3) | direct DELETE of an X link, blocked | serialized; no 40P01 |
| **R20** | question state change on Q∈X: approve→`needs_revision`, soft delete, or new version | `publish_test(X)`, blocked on Q (step 5, **before** validation) | commit A ⇒ B fails `validation failed: <check>`, or freezes the **new** version; never a stale approval or version |
| **R21** | `start_attempt(X)` on published, open X (holds the test row); fixture `opens_at` is then moved to the future as runner to isolate the attempt check | direct `update tests set status='draft'`, blocked | commit A ⇒ B fails G2 (`test_has_attempts`); attempt rows unchanged. Sequential variant: a direct `draft` flip on a test with no attempts but already opened fails `test_already_open_or_unscheduled` |
| **R22** | `publish_test(X)` holds | B (an `edit_questions`-only role) calls `publish_test(X)` / `return_to_draft_test(X)` | B gets the permission error **without blocking** (`pg_blocking_pids(B)` stays empty) |
| **R23** | three sessions. A: Q year change (Q unlinked; Y1 passes; holds Q). C: attach Q→X, committed, seeing the old year. | B: direct hand-frozen `status='published'` on X. PR13's trigger passes on the unlocked old year; G1 (b) blocks on Q | commit A ⇒ G1 (b′) re-reads Q ⇒ B fails 23514. Same with B = `publish_test(X)`: L1 step 5 blocks and B fails 23514 |
| **R24** | attach into draft X (holds the test row; the new link is uncommitted) | `publish_test(X)`: L1 step 2 completes **without** blocking on the new row, then blocks at step 3 on the test row | commit A ⇒ B's second L0 (step 4) locks the new link ⇒ B publishes it **frozen**; count exact. This proves the second L0 |
| **R25** | as R24, plus C: direct UPDATE of the new link, issued right after A commits | B is `publish_test(X)` | X3 residual. **Outcome-class assertion, 20 iterations**: each iteration ends in exactly one of (i) B freezes, and C is blocked and then rejected `only voiding…`, or (ii) exactly one 40P01 with full rollback of the victim. Invariants hold every time |
| **R26** | attach into draft X (holds the test row) | `delete_draft_test(X)`: L3 L0 passes, then blocks on the test row | commit A ⇒ L3′ locks the new link ⇒ the test and **all** links are deleted, with no orphan `test_questions` and no 40P01 |
| **R27** | A: `update tests set min_questions = …` on draft X (holds the test row) | B: `publish_test(X)`, blocked at L1 step 3 | commit A ⇒ B validates the **committed** new `min_questions` (pass or fail accordingly). This is the RPC-path counterpart of the mixed-update rejection |

### 5.1 Fixture compatibility (test-only changes in the same wave)

G0–G3 also bind the superuser and service role. The implementation re-greps; these are the known direct status flips:

| File | Current | Test-only remediation |
|---|---|---|
| `supabase/tests/161_8jb_own_test_result.sql:326` | runner `update … status='published'` on a draft with no questions | Build it with `test_helpers.make_published_test`, or a new `test_helpers.force_test_status(id, status)`. That helper disables only `tests_zz_guard_status_transition` inside the rolled-back pgTAP tx (the temporary-toggle pattern 248 already uses) and is never shipped in a migration. |
| `supabase/tests/244_test_return_draft_reuse_syllabus.sql:83,102` | two runner direct publishes | same |
| `tests/e2e/test-draft-manage.spec.ts:46`, `tests/e2e/test-draft-complete-edit.spec.ts:49` | admin PostgREST `PATCH {status:'published'}` (this is exactly the bypass) | call the `publish_test` RPC on a fixture holding ≥ `min_questions` approved questions |
| `tests/e2e/fixtures.ts:305` (staging teardown via psql) | `status='draft'`, then delete | **Flag only.** It runs against staging only, which is out of scope. The teardown change must be approved together with any future staging apply. |

## 6. Release gates (none authorized by this plan)

1. D1 founder approval.
2. Independent R2 acceptance of this r3 plan.
3. On a fresh disposable clone: 248, 245 and the full race script pass, with a rollback-baseline check. R14's negative control must show the r1 design deadlocking.
4. Full `npm run test:db` on disposable PG.
5. Independent R2 review of the implementation diff.
6. Separate explicit approval for any staging or production apply.

## 7. Implementation wave (single Sonnet wave, ordered; not authorized yet)

1. Docs D1 (after approval).
2. Migration: L0–L4 (with L3′), C1, Y1, Y2, G0–G3.
3. pgTAP 248, including the r3 authenticated negatives and the unchanged-history hashes, plus the §5.1 fixture remediations (pgTAP and local e2e only).
4. Race script R1–R27.
5. A1 mapping and its unit test (`tests/unit/publish-test-errors.test.ts`).
6. Local disposable run with exact counts, then commit, non-force push and checkpoint. Review stays PENDING_R2.

Out of scope:
- repairing the 21 links;
- attempt or score recompute;
- any RLS, grant or role change, including revoking direct DML (the only way to remove X1/X2);
- year-scoped admin RLS;
- `used_in_test` semantics;
- re-ordering locks inside the bulk MCQ RPCs (X4);
- transitions other than into `published` or `draft`.
