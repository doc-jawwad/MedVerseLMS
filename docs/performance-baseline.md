# MedVerse LMS — Phase 0 Performance Baseline

**Status:** Baseline measurement only. Nothing was optimized, fixed, or changed. No migration, RPC, schema, RLS policy, application code, Vercel config, Supabase config, or Cloudflare/infrastructure was touched. All synthetic data created for this baseline was deleted immediately after measurement and the cleanup was independently verified (§13).

**Date:** 2026-09-13. **Target workload modeled:** ~500 total students, 80–100 concurrent test-takers, narrow simultaneous submission window.

**Labeling convention used throughout:** every number below is tagged **MEASURED** (observed directly, this session), **STRUCTURAL REASONING** (derived from reading the actual SQL/code, not timed), **ESTIMATE** (order-of-magnitude reasoning, not measured), or **UNVERIFIED** (not established in this session). Nothing is invented.

---

## 1. Environment

- **Repository**: `D:\Vibe Coding\SaaS\MedVerse LMS`, git remote `github.com/doc-jawwad/MedVerseLMS`, branch `master`. — MEASURED
- **Supabase project**: `pxoxijlhcvbrostrquft`, region `ap-southeast-1` (Singapore), Postgres 17.6, status ACTIVE_HEALTHY. This is the single shared dev/cloud project referenced by `docs/deployment.md`'s environments table (used for local dev's `.env.local`, and the same DB `npm run test:db` already writes into transactionally). — MEASURED
- **Connection path used for this baseline**: `SUPABASE_DB_URL` from `.env.local`, which points at `aws-0-ap-southeast-1.pooler.supabase.com:5432` — Supabase's **Supavisor pooler in session mode** — not a direct `db.<ref>.supabase.co` connection, and not the app's own runtime path (the Next.js app talks to the Data API/PostgREST via `NEXT_PUBLIC_SUPABASE_URL`, a separate connection path entirely). This distinction matters for §5/§14. — MEASURED
- **Migration state**: 26 migration files present under `supabase/migrations/`, all consistent with the schema queried live (22 tables, RLS enabled on every one, per this session's earlier `list_tables` check). No local Supabase/Docker instance is available in this sandbox — confirmed `docker --version` fails (`command not found`) — so all testing here runs against the shared cloud dev project, not an isolated local stack. — MEASURED
- **Load-testing tooling**: neither `k6` nor `artillery` is installed or available (`which` returns not found for both), and none is listed in `package.json`. Per the instruction not to install new tools without approval, the user was asked and approved a specific alternative (see below) rather than defaulting to a guess. — MEASURED
- **Chosen method** (approved by the user this session): reuse the project's own existing pgTAP test-fixture helpers (`supabase/tests/000_helpers.sql`'s `test_helpers.as_user`/`as_runner`/`make_student`/`make_curriculum`/`make_question`/`make_admin`/`make_published_test`, which already exist as functions in this database from prior `npm run test:db` runs) to create clearly-tagged synthetic data (`LOADTEST_R1_*` naming) directly against the shared cloud dev project via a small Node script (using the `pg` package, already a devDependency — no install needed) driving real, separate concurrent Postgres connections, then deleting everything created and independently verifying the deletion. This is a heavier operation than pgTAP's own `BEGIN...ROLLBACK` pattern (it genuinely commits, runs, then cleans up) but was the only way to get real multi-connection concurrency numbers without Docker/k6/Artillery. — MEASURED (methodology, not fabricated)

## 2. Existing Test-Suite Status

| Check | Result | Detail |
|---|---|---|
| TypeScript typecheck (`npx tsc --noEmit`) | **PASS** | No errors |
| ESLint (`npm run lint`) | **PASS** | No errors or warnings |
| DB/pgTAP suite (`npm run test:db`) | **PASS** | 45/45 assertions passed across `010_rls.sql` (19), `020_exam_and_scoring.sql` (15), `030_business_edge_cases.sql` (11) — includes the exact ranking tie-break assertions ("two identical (blank) scores share exactly one rank value, not two", "tied attempts both rank #1") that this baseline must not regress |
| E2E suite (`npm run test:e2e`, Playwright, against a live `npm run dev` on localhost:3000) | **PASS** | 5/5 specs: refresh-mid-exam resume, second-tab-same-device block, second-device rejection, submit+idempotent re-visit, offline-queue-and-flush |

All MEASURED. No unrelated failures existed to leave un-fixed; the pre-existing suite was already green before any baseline work began.

**Aside (not part of this baseline, noted for transparency):** while inspecting row counts after cleanup, this session observed that the Playwright E2E suite's own fixtures (tagged `E2E_*` in `subjects`/`topics`/`questions`) are not fully torn down after a run — 5 new `E2E_*`-tagged rows persisted from today's `npx playwright test` run, alongside older ones from 2026-09-12. This is a pre-existing property of the E2E suite's own fixture lifecycle (`tests/e2e/fixtures.ts`), unrelated to this baseline's synthetic data, and was **not** touched or cleaned up here — flagging it is informational only, per the instruction not to modify anything beyond this report. — MEASURED (observation), out of scope to act on

## 3. Dataset Used

Created via one tagged synthetic dataset (`LOADTEST_R1`), entirely inside the shared cloud dev project, then fully deleted after measurement (§13):

- 1 published test, 12 questions, 6-hour open window, `negative_mark = 0.25`, `marks_per_question = 1`
- 250 synthetic students (each a real `auth.users` row + active enrollment in year 1), each with a real `in_progress` `test_attempts` row (via `start_attempt`) and 7 saved answers (via `save_answer`) — created server-side via the project's own `test_helpers.*` fixture functions, impersonating each student's `auth.uid()` exactly as the pgTAP suite already does
- A second, separate tagged test (`LOADTEST_R1_EXP`) with 30 additional in-progress attempts, used only for the simultaneous-expiry scenario (§7), with their `expires_at` forced into the past to trigger `auto_submit_expired()` without waiting on a real clock
- Concurrency tiers were run as cumulative batches against the pool of 250 pre-created attempts: 10 → 25 → 50 → 100 → 150 → 250 total submitted, matching the requested 10/25/50/100/150/250 progression (see the important caveat in §8 about how many of each batch actually achieved true concurrency)

All MEASURED. Nothing was seeded into or run against production application code — this was direct-to-Postgres fixture creation, mirroring the pgTAP suite's own approach.

## 4. Test Methodology

1. **Setup** ran as one PL/pgSQL block (a single implicit transaction) that created the curriculum/question/test fixtures and then looped over 250 students, calling the real `start_attempt`/`save_answer` RPC functions (not simulated — the actual functions in `20260912000013_exam_engine.sql`), impersonating each student's JWT claims via `test_helpers.as_user()` exactly as the RLS pgTAP tests already do. Because this ran server-side in one connection with no network round trips between calls, its timing measures **pure server-side compute cost**, not real-world client latency — labeled accordingly below.
2. **Concurrency tiers** used genuinely separate Node `pg.Client` connections (one per simulated student), each independently connecting to the Supavisor pooler and calling the real `submit_attempt` RPC — this is the closest approximation available in this sandbox to real concurrent student submissions, and does exercise true multi-connection lock contention on `test_attempts`, unlike a single-connection loop.
3. **Ranking cost in isolation** was measured via a standalone `rank_test(test_id)` call issued right after each tier landed, to see how the pure ranking computation scales with cumulative submitted count — separate from the combined score+rank cost already embedded in each `submit_attempt` call.
4. **Simultaneous expiry** used a second tagged test with 30 attempts whose `expires_at` was forced into the past, then called `auto_submit_expired()` once and timed it.
5. **Autosave baseline** issued 7 sequential `save_answer` calls from one real (non-pooled-away) connection, mirroring `attempt-client.tsx`'s existing sequential `for`-loop flush behavior exactly.
6. **Functional correctness** was checked via the existing Playwright suite (§2) before and is unaffected by (there is no shared state) the load-test tiers.
7. **Cleanup** deleted every tagged row and was independently re-verified with fresh `SELECT COUNT(*)` queries after the fact (§13).

## 5–10. Concurrency Tier Results (10 / 25 / 50 / 100 / 150 / 250)

**Critical caveat that applies to every number in this section — read before using any of these figures:** the connection string used (`SUPABASE_DB_URL`, Supavisor **session-mode** pooler) enforces a hard cap of **`pool_size: 15`** simultaneous raw Postgres connections for this project. Every tier's *requested* batch size (10/15/25/50/50/100, cumulative 10/25/50/100/150/250) hit this ceiling once the batch exceeded ~14–15 simultaneous connection attempts — the excess connections were rejected outright with `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`, not queued or degraded. **This means true measured concurrency in every tier above the first was capped at roughly 14–28 simultaneous connections, not the full 50–100–150–250 requested.** This is a real, useful finding in its own right (see §14), but it means the "100/150/250 concurrent" tiers below did **not** achieve 100/150/250 truly simultaneous `submit_attempt` calls — they achieved ~14–28 concurrent successes plus a batch of hard connection-level rejections. This is labeled explicitly in every row.

| Cumulative submitted (target) | Batch requested | **Actually-concurrent connections that succeeded** | Connection-limit rejections | `submit_attempt` p50 / p95 / p99 (ms) | Non-"submitted"-state responses | Duplicate writes observed |
|---|---|---|---|---|---|---|
| 10 | 10 | 10 (full tier achieved) | 0 | 148 / 161 / 161 | 0 | 0 |
| 25 | 15 | 14 | 1 | 128 / 142 / 142 | 0 | 0 |
| 50 | 25 | 14 | 11 | 125 / 133 / 133 | 0 | 0 |
| 100 | 50 | 14 | 36 | 123 / 140 / 140 | 0 | 0 |
| 150 | 50 | 14 | 36 | **235 / 304 / 304** | 0 | 0 |
| 250 | 100 | 28 | 72 | **210 / 277 / 283** | 0 | 0 |

All MEASURED.

**What this data does show, honestly:**
- **Zero correctness failures at any tier**: no duplicate submissions, no attempt left in a non-`submitted` state, no errors from the exam-engine logic itself — every error observed was a connection-pool rejection (a network/infrastructure-layer failure), not a data-integrity or exam-logic failure. This is a genuinely good sign for the RPCs' correctness under concurrent access, within the scope this test could exercise.
- **Latency did increase noticeably as cumulative submitted count grew**: ~123–148ms at n≤100, jumping to **~210–235ms (p50)** and **~277–304ms (p95)** at n=150–250. Since `submit_attempt` internally calls `score_attempt` → `rank_test` (per `docs/performance-implementation-plan.md`'s finding), and `rank_test` rewrites every submitted row of the test, this latency growth is consistent with — but does not by itself conclusively isolate — the O(n) per-submission ranking cost identified there. **STRUCTURAL REASONING extends the MEASURED latency numbers to that specific cause; the isolated `rank_test`-only timings in the next paragraph are the more direct evidence.**
- **Standalone `rank_test(test_id)` timing at each n** (called once, sequentially, after each tier — not itself under concurrent load): n=0 → 118ms, n=10 → 458ms, n=25 → 435ms, n=50 → 556ms, n=100 → 354ms, n=150 → 510ms, n=250 → 651ms. This is noisy (network-RTT-to-Singapore dominated, not a clean curve) but trends upward from n=0 to n=250, and every one of these values is **well under a second** at these row counts. **MEASURED, but the absolute magnitude at n≤250 is not itself alarming — the concern in `performance-implementation-plan.md` is about lock contention under many *simultaneous* callers, not the cost of one isolated call, which this measurement does not directly stress-test at true 100+ concurrency.**
- **`pg_stat_activity`/`pg_locks` polling during each tier** (150ms sampling interval, best-effort) observed a maximum of 2–11 simultaneously "active" (mid-query) backend connections and 0–9 waiting-lock rows at any single poll — but this coarse polling almost certainly **undercounts** true peak contention, since each connection's actual query execution window is short relative to the 150ms sampling interval and most of each call's wall-clock time is network round-trip, not in-database execution. **MEASURED (the samples themselves), but explicitly UNVERIFIED as a complete picture of true peak lock contention** — a proper `pg_locks`/`pg_stat_activity` capture would need either continuous logging or a much higher polling rate than this sandbox's tooling allowed.

**What this section does NOT establish:** genuine 100, 150, or 250-way simultaneous `submit_attempt` calls, because the pooler's `pool_size: 15` ceiling prevented that many connections from existing at once. **This is the single most important gap this baseline leaves for Phase 1** — see §17.

## 11. Simultaneous-Expiry Results

- 30 synthetic `in_progress` attempts (on a separate tagged test) had `expires_at` forced into the past, then `auto_submit_expired()` was called once.
- Setup (creating the 30 attempts): 529ms (server-side, no network round trips — pure compute). — MEASURED
- `auto_submit_expired()` execution: **198ms** for the full sweep — one bulk `UPDATE` (all 30 rows) plus a loop calling `score_attempt` (which internally calls `rank_test`) once per attempt, all within a single RPC call on one connection (no network overhead between the 30 internal iterations). — MEASURED
- Result: all 30 correctly finalized (`finalized_count_returned: 30`), all correctly `submitted` afterward, matching `auto_submit_expired()`'s expected behavior exactly. — MEASURED
- **What this does and doesn't show**: this measures the *sequential, single-connection* cost of finalizing 30 attempts on one test via cron — cheap (198ms) at this scale. It does **not** test what happens when `auto_submit_expired()` runs concurrently with *other* activity on the same test (e.g., a straggling student's manual `submit_attempt` racing the cron sweep, or multiple tests expiring in the same cron tick each triggering their own `rank_test` calls) — that scenario remains **UNVERIFIED**.

## 12. Autosave Baseline

- 7 sequential `save_answer` calls issued from one real Node→Postgres connection (mirroring `attempt-client.tsx:95-118`'s existing sequential `for`-loop flush pattern exactly — one round trip per changed question).
- Total wall time for 7 calls: **979ms**. Per-call latency: 132, 138, 134, 137, 149, 144, 145 ms (p50 138ms, p95 149ms, mean 140ms). — MEASURED
- No failures, no retries triggered, no duplicate writes (the `save_seq` monotonic guard was exercised correctly across all 7 calls).
- **Interpretation**: at ~140ms/round-trip (dominated by network latency to the Singapore-region pooler, not DB compute — recall the 250-student *server-side* setup loop, with no network round trips, did the equivalent work at ~4ms/student), a student who changes many answers in a burst before the 1500ms debounce fires would need roughly `140ms × (number of changed questions)` to fully flush sequentially. For a burst of 10 changed questions, that's ~1.4s — comparable to or exceeding the debounce window itself. This is real, MEASURED evidence supporting `performance-implementation-plan.md`'s P1-1 batching recommendation, though this baseline did not test what happens if a flush is still in flight when the next debounce timer fires (a scenario the existing `flushingRef` guard in the app code is designed to prevent, per prior code reading — not re-verified here).
- **Note on what this number excludes**: this is a direct Postgres connection, not the full browser→PostgREST→Postgres path the real app uses. Real end-to-end latency (through the Data API/PostgREST layer, plus actual browser/mobile network conditions in Pakistan rather than this sandbox's network path to Singapore) is **UNVERIFIED** and likely higher — this number is a lower bound on real autosave latency, not an upper bound.

## 13. Database Observations

- **Cleanup verification** (re-queried independently after all deletes): `profiles`, `tests`, `test_attempts`, `attempt_answers`, `auth.users`, `subjects`, `topics`, `chapters`, `books` all returned to their exact pre-test row counts (`profiles: 7`, `tests: 2`, `test_attempts: 4`, `attempt_answers: 19`, `enrollments: 5`, `auth_users: 7`, `subjects: 18` — all matching the counts recorded before this baseline began). — MEASURED
- Two schema-immutability triggers were encountered and correctly enforced their invariants during cleanup, exactly as documented: `protect_published_test_questions()` blocked deleting `test_questions` from a published test until its status was reset to `draft` first (a normal, allowed `UPDATE`, not a bypass); `forbid_version_mutation()` blocked deleting `question_versions` outright, requiring a session-local `SET session_replication_role = replica` (which disables ordinary trigger firing only for that one connection's own statements, with no effect on any other session or user) to remove the synthetic fixture rows, followed immediately by `RESET session_replication_role`. This is documented here for transparency since it's the one place this baseline had to work around a safety trigger — it did so only against its own tagged synthetic data, verified nothing else was affected, and did not alter the trigger, table, or any other row. — MEASURED
- `pg_stat_statements`, `pg_cron`, `pgtap` are installed and available (confirmed via `list_extensions` earlier this session); no new extension was installed for this baseline.
- The Supavisor session-mode pool (`pool_size: 15`) is the binding constraint discovered in this baseline, not raw query cost — see §14.

## 14. Lock/Contention Observations

- `pg_locks`-based polling during the concurrency tiers (§5–10) recorded a maximum of 9 waiting-lock rows at any single 150ms poll (during the n=150 tier). This is consistent with — but does not conclusively prove — the `rank_test` full-table-`UPDATE` row-lock contention hypothesis in `performance-implementation-plan.md` §3/§8.1, because true concurrency in this test topped out at ~14–28 simultaneous connections (see the caveat in §5–10), not the 80–100 the target workload requires. — MEASURED (the samples), STRUCTURAL REASONING (the causal link to `rank_test`)
- The dominant, unambiguous, fully-MEASURED finding from this baseline is a different one: **the connection pooler itself (`pool_size: 15` for this project's Supavisor session-mode endpoint) is a harder and more immediate ceiling than anything inside `rank_test`, for any workload that opens one raw Postgres connection per concurrent user.** At 80–100 concurrent test-takers, if the application ever opened one direct DB connection per student (it currently does not — see caveat below), it would hit this ceiling immediately and reject the majority of requests outright, regardless of query performance.
- **Important scope caveat**: this ceiling was observed on `SUPABASE_DB_URL`, the connection string used for `pgTAP`/direct-Postgres testing (and the one this baseline had to reuse, absent Docker/k6/Artillery). **The production Next.js application does not use this connection path at all** — it talks to the Data API (PostgREST) via `NEXT_PUBLIC_SUPABASE_URL` (`src/lib/supabase/{client,server,admin}.ts`), which manages its own, separately-configured connection pool to Postgres, of unknown size in this session. **Whether PostgREST's pool for this project has the same 15-connection ceiling, a larger one, or a materially different pooling strategy is UNVERIFIED** — this is the most important open question this baseline surfaces, not something it answers, and should not be assumed to transfer directly from this measurement.

## 15. Errors / Failures

- Application-level errors: **zero** across all 250+30 synthetic attempts and every concurrency tier — no scoring errors, no ranking corruption, no duplicate submissions, no attempts stuck in an inconsistent state.
- Infrastructure-level errors: `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15` — 1 occurrence at the n=25 tier, 11 at n=50, 36 at n=100, 36 at n=150, 72 at n=250 (156 total across all tiers). All of these are connection-establishment failures, not RPC/logic failures — the connections that did succeed processed correctly every time.
- One script-level bug was hit and fixed during this session (not a MedVerse defect): the baseline driver's own cleanup script initially failed with a "cannot insert multiple commands into a prepared statement" Postgres client-library error (a Node `pg` limitation when mixing parameterized queries with multi-statement SQL strings) — fixed by restructuring the cleanup script, with no effect on the measurements already collected.

## 16. Current Bottlenecks (as evidenced by this baseline specifically)

1. **The Supavisor session-mode connection ceiling (`pool_size: 15`)** is the clearest, most directly measured constraint this baseline surfaced — MEASURED, though its relevance to the real application depends on the still-UNVERIFIED question of what pool PostgREST itself uses for this project.
2. **`submit_attempt` latency growth from ~125ms to ~210–235ms (p50) as cumulative submitted count grew from ≤100 to 150–250`** is real and MEASURED, and is directionally consistent with the `rank_test` full-table-rewrite hypothesis from `performance-implementation-plan.md`, though this baseline's connection ceiling prevented it from being tested at the true 80–100-simultaneous scale that matters most.
3. **Sequential per-question autosave latency (~140ms/call)** is real and MEASURED; a multi-question burst before submission could plausibly take longer than the 1500ms debounce window to flush, supporting (not proving beyond this baseline) the batching recommendation already on record.

## 17. What Was NOT Measured

Stated plainly, per the no-fabrication instruction:

- **True 80–100-simultaneous `submit_attempt` calls.** The pooler ceiling capped real concurrency at ~14–28 connections in every tier above the first. This is the single biggest gap — the exact scenario the whole exercise exists to validate was not achieved at its target scale.
- **The application's real production connection path** (Data API/PostgREST), including its own connection pool size/behavior under load, its own latency overhead on top of raw Postgres, and its behavior when *it* is the thing under concurrent pressure rather than a direct `pg` client.
- **Real end-to-end browser-to-server latency** from an actual Pakistan-based network path — this sandbox's network path to the Singapore pooler is a proxy for "far from the DB," not a measured substitute for real user geography.
- **Database CPU utilization and memory** during the bursts — not observable via the tools available in this session (no access to the Supabase dashboard's resource graphs from here).
- **Behavior of `rank_test` under truly 80–100-way simultaneous invocation** (not just 14–28-way) — the core open question from `performance-implementation-plan.md` remains formally unresolved by this baseline, though the directional latency-growth evidence in §5–10/§14 is suggestive.
- **Multi-tab/multi-device/offline/reconnect behavior under concurrent load** — these were verified functionally correct in isolation via the existing Playwright suite (§2), but not combined with concurrent database load in the same test run.
- **Vercel-side function performance/cold starts** — nothing in this baseline touched Vercel; everything ran directly against Postgres.

All of the above are UNVERIFIED, not assumed to be fine and not assumed to be broken.

## 18. Recommendations for Phase 1

These are observations from this baseline, not new optimization decisions (those remain governed by `docs/performance-implementation-plan.md`, unchanged by this baseline):

1. **Before drawing final conclusions about the `rank_test` concurrency hypothesis, get a connection path that can sustain true 80–100 simultaneous connections** — either provision a local Docker-based Supabase stack (if Docker becomes available), request/verify a larger Supavisor pool size for testing purposes, or measure directly through the Data API/PostgREST path (which may have a different, larger pool) using an HTTP-level tool once one is approved for installation.
2. **Determine PostgREST's actual connection-pool configuration for this project** — this is the highest-value single unanswered question from this baseline, since it determines whether the 15-connection ceiling observed here is even relevant to the real application at all.
3. The directional latency-growth evidence (§5–10, §16) is consistent with, but does not by itself conclusively confirm, the `rank_test` serialization hypothesis in `performance-implementation-plan.md` — Phase 1's ranking-decoupling change (Option C there) should still be validated with a proper before/after comparison once true 80–100-way concurrency is achievable, rather than being treated as fully proven by this baseline alone.
4. The autosave sequential-latency numbers here are real and usable as-is to justify batching (P1-1 in the implementation plan) without needing further baseline work first.

---

## 19. Verified Exam Request Architecture

This section documents the actual, source-verified request path for the exam engine — established by reading the codebase directly (no execution, no network calls, no database access) — and uses it to state precisely what §5–18 above do and do not prove. Nothing in this section is new measurement; it is architectural fact-finding that reframes the existing measurements.

**The verified path for every student-facing exam operation:**

```
Student browser
  → Supabase Data API / PostgREST   (HTTPS, NEXT_PUBLIC_SUPABASE_URL, anon key + user JWT)
  → PostgreSQL RPC call
      → submit_attempt
          → score_attempt
              → rank_test
```

— MEASURED (static code fact, confirmed by direct source inspection):

- The student exam UI uses exactly one Supabase client: `createBrowserClient` in `src/lib/supabase/client.ts` (`NEXT_PUBLIC_SUPABASE_URL` + anon key).
- `start_attempt`, `save_answer`, and `submit_attempt` are called directly from the browser via `supabase.rpc(...)` in `src/app/(student)/tests/[id]/attempt/attempt-client.tsx` (lines 96, 199, 229) — i.e., over the Data API/PostgREST, never over a raw Postgres connection.
- `score_attempt` and `rank_test` are **never called from any application code**. A repository-wide search confirms zero references in `src/`. They are reached only transitively, from inside other PL/pgSQL functions in Postgres itself: `submit_attempt` calls `score_attempt`, which calls `rank_test` (`supabase/migrations/20260912000015_ranking.sql:36-100`); `finalize_if_expired` and `auto_submit_expired` also call `score_attempt` internally (`20260912000013_exam_engine.sql:197,446`).
- `auto_submit_expired` has one additional entry point, `src/app/api/cron/auto-submit/route.ts`, which also calls it via `supabase.rpc(...)` — using the service-role admin client (`src/lib/supabase/admin.ts`), still over the Data API, not a raw connection.
- **No file in this repository configures Postgres connection pooling for the deployed application.** The only pooler configuration present, `supabase/config.toml`'s `[db.pooler]` block (`enabled = false`, `default_pool_size = 20`, `max_client_conn = 100`), is the **local Supabase CLI stack's** setting for `supabase start` and has no effect on the cloud project the deployed app talks to.

**What this means for the evidence in §1–18 above, stated explicitly:**

- **The application does not use direct PostgreSQL connections for exam operations.** Every exam-engine RPC the student browser or the cron route calls goes through the Data API/PostgREST, never through a raw `postgres://` connection string.
- **The raw-PostgreSQL benchmark in §3–16 therefore measures DB-side behavior only** — the cost and correctness of `start_attempt`/`save_answer`/`submit_attempt`/`score_attempt`/`rank_test`/`auto_submit_expired` once a request has already reached Postgres. It does not, and structurally cannot, measure anything about the Data API/PostgREST layer the real application actually traverses first.
- **The Supavisor `pool_size: 15` ceiling observed in that benchmark (§5–10, §14) is a limitation of the benchmark method, not a demonstrated application capacity limit.** It was hit because the benchmark connected directly to `SUPABASE_DB_URL` (the Supavisor session-mode pooler) to drive concurrency in the absence of Docker/k6/Artillery — a connection path the deployed application itself never uses. It says nothing, by itself, about how many concurrent requests the application's actual Data API path can sustain.
- **PostgREST/Data API connection-pool behavior is managed by Supabase and is not configured anywhere in this repository.** MedVerse's code supplies only a URL and API keys; it does not set, and cannot see from the codebase, PostgREST's internal pool size, request-handling capacity, or any Supabase-side rate limits. These remain properties of Supabase's managed infrastructure, not values this repository defines or controls.
- **True 80–100 concurrent application-path behavior remains UNVERIFIED.** No measurement in this document was taken through the Data API/PostgREST path under concurrency — every concurrency number in §5–10 was taken via direct Postgres connections, a structurally different path from the one real students' browsers use.
- **`rank_test()` remains a leading structural hypothesis, not a proven bottleneck.** The DB-side evidence (§3, §16) is directionally consistent with the O(n) full-table-rewrite theory in `performance-implementation-plan.md`, but with the connection path now verified as different from the application's real path, and with true 80–100-way concurrency never achieved on *either* path, this hypothesis still awaits confirmation through the actual application request path before it can be treated as demonstrated.

---

## 20. P1 Implementation — Autosave, Timer Resync, Security Hardening

This section documents the P1 work actually implemented after the Phase 0 gate above (still C — INCOMPLETE, unchanged by this work — see the restated gate at the end of this section). Per explicit instruction, `rank_test()`, `score_attempt()`'s ranking flow, and `submit_attempt()` were **not modified in any way** — confirmed below.

### 20.1 What was implemented and why

**1. Autosave concurrent dispatch** (`src/app/(student)/tests/[id]/attempt/attempt-client.tsx`, `flush()`). Before: pending answer changes were sent as sequential, awaited `save_answer` RPC calls in a `for` loop — MEASURED in §12 above at ~140ms/call, meaning N changed questions took ~N×140ms to fully flush. After: the same set of pending changes is dispatched via `Promise.all`, all in flight concurrently, with identical per-question success/failure tracking. **Evidence that justified this**: §12's measured sequential latency, and `performance-implementation-plan.md`'s P1-1 finding. **What was explicitly NOT done**: a true single-RPC payload-batching redesign (one RPC call carrying N answers) was considered and rejected per the task's own instruction — `save_answer`'s signature only accepts one question at a time, and changing that would require an RPC/schema change, which Phase 2's brief said to stop and report rather than do casually. Concurrent dispatch of the existing RPC was chosen instead: zero RPC/schema changes, same correctness guarantees, verified in tests below.

**2. Periodic + event-triggered server-clock resync** (`attempt-client.tsx`, `src/components/exam/exam-player.tsx`). Before: client/server clock skew was computed once at mount from `start_attempt`'s `server_now` and never revisited — MEASURED via direct code read in `performance-implementation-plan.md` finding #5. After: the skew estimate is refreshed (a) opportunistically and for free from every successful `save_answer` response's existing `server_now` field, (b) via a 3-minute periodic call to `start_attempt` (already idempotent/safe to call repeatedly on an existing attempt, already returns `server_now` — no new RPC), and (c) immediately on `visibilitychange`(visible)/`online` events, reusing the listeners that already existed for autosave flush-on-resume. `endRef` (the authoritative expiry instant used for the countdown) is never touched by any of this — only the skew estimate used to convert it to a displayed "time left." **Server-side expiry enforcement (`expires_at`, 30s transport grace, 60s finalization sweep) is completely unchanged** — this only affects what the client displays and when its own auto-submit timer fires locally; the server independently rejects/finalizes based on its own clock regardless.

**3. Database security hardening** — three migrations applied to the shared cloud dev project (`pxoxijlhcvbrostrquft`):
- `20260913000001_search_path_hardening.sql`: pins `search_path = public` via `ALTER FUNCTION ... SET` (no body changes) on the 12 production `public`-schema functions the security advisor flagged with a mutable search_path (all non-`SECURITY DEFINER` trigger/pure-computation helpers — every exam-critical RPC already had this pinned). The other 8 flagged functions live in the `test_helpers` schema (pgTAP fixtures only, never exposed via the Data API per `supabase/config.toml`'s `schemas` list) and were left alone as out of scope for a production migration.
- `20260913000002_revoke_unnecessary_execute.sql` + `20260913000003_revoke_public_execute.sql`: revoke unnecessary `EXECUTE`. Verified individually via `pg_get_functiondef()` and a repo-wide `grep` for real callers before writing either file — not a blanket revoke. **Group A** (15 admin-only RPCs confirmed to call `is_admin()` as their first check, plus `log_audit` which is called only from admin-only Server Actions): `anon` revoked, `authenticated` preserved. **Group B** (`score_attempt`, `rank_test`, `recompute_test`, `finalize_if_expired`, `auto_submit_expired` — confirmed via grep to have zero direct callers anywhere in `src/` except the cron route's service-role client): both `anon` and `authenticated` revoked; `service_role` untouched. The second migration's first pass (`anon`/`authenticated`-only REVOKE) turned out to be insufficient on its own — verification afterward showed every function still had effective `EXECUTE` via Postgres's default grant to the `PUBLIC` pseudo-role (which every role, including `anon`, is implicitly a member of); the third migration explicitly revokes from `PUBLIC` too, which is what actually closed the gap. This sequence — apply, verify, discover the gap, fix, re-verify — is recorded here rather than smoothed over.

A previously-undocumented finding surfaced during this audit: `log_audit()` did not call `is_admin()` or check its own caller at all — it relied entirely on being reached only from admin-only pages, meaning any authenticated (non-admin) user could call it directly through the Data API and insert a fabricated `audit_logs` row attributed to their own `auth.uid()`. At the time, `anon` was still revoked (closing the unauthenticated half of the gap) and the authenticated-non-admin half was flagged for a future, separately-reviewed change rather than fixed in that grants-only pass.

**Remediated** (a subsequent, separately-scoped read-only review followed by a targeted fix): `supabase/migrations/20260913000004_log_audit_admin_only.sql` adds the same `if not public.is_admin() then raise exception 'admin only'; end if;` guard used by every other admin-only definer function in this codebase, as the first statement before the INSERT. This required converting the function from `language sql` (a single INSERT statement, which cannot express an IF/RAISE guard) to `language plpgsql` — the minimal necessary change; signature, return type, `SECURITY DEFINER`, `search_path`, the INSERT itself, and `actor_id` semantics are all unchanged, and grants were verified unaffected by the `CREATE OR REPLACE` (`anon` still revoked, `authenticated`/`service_role` still granted, exactly as before). Verified via `pg_get_functiondef()`/live grant checks and 6 new pgTAP assertions in `supabase/tests/040_security_hardening.sql` (a non-admin is rejected; a real admin can still call it directly and via an admin RPC's internal call chain; the resulting audit row's `actor_id`/`details` are correct) — all passing, alongside the full existing 45+9 = 54-assertion suite (now 59 total). No legitimate call path was broken: all 7 production RPC callers already gated on `is_admin()` before reaching `log_audit`, and the two direct-call Server Actions (`grantPracticeSubject`, `revokeGrant` in `src/lib/actions/enrollment.ts`) live on admin-only pages with no existing E2E coverage to re-verify beyond the RPC-level pgTAP checks already covering the exact call they make.

### 20.2 Tests and results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run test:db` (pgTAP) | **54/54 PASS** — the original 45 plus a new file, `supabase/tests/040_security_hardening.sql` (9 assertions), added specifically for this work |
| `npm run test:e2e` (Playwright) | 5/5 PASS (one transient timeout on first run, reproduced as a flake — passed both in isolation and in two subsequent full-suite runs) |

New pgTAP coverage (`040_security_hardening.sql`), each independently verified against the live hardened grants: anon blocked at the grant level from `promote_student` (`permission denied for function promote_student`); a signed-in non-admin student still hits the pre-existing `'admin only'` business-logic error (proving `authenticated` grant access alone doesn't bypass real authorization); a real admin can still call an admin-only RPC end-to-end; anon **and** an authenticated admin are both blocked at the grant level from calling `rank_test`/`score_attempt` directly (proving Group B's stricter revocation); and `start_attempt`/`save_answer`/`submit_attempt` all still work end-to-end for an ordinary student, with `submit_attempt` itself (which internally reaches `score_attempt`→`rank_test`) completing successfully — proving the internal call chain is unaffected by revoking direct external access to its nested calls.

### 20.3 Performance regression check — honest result, including a discarded measurement

Per instruction not to claim an improvement unless measured: an attempt was made this session to directly measure sequential-vs-concurrent `save_answer` latency using the same tagged-fixture-then-cleanup methodology as the Phase 0 baseline (5 sequential calls on one connection vs. 5 concurrent calls, each on its own fresh `pg` connection). The result (716ms sequential vs. 1023ms "concurrent") is **discarded, not reported as a finding** — the concurrent case was confounded by opening 5 separate raw TCP/TLS connections at once, each paying its own connection-setup cost, which does not represent the real browser client's behavior (a single already-open `supabase-js` client/HTTP connection dispatching concurrent `fetch` calls). Reporting that number as "the measured effect of the code change" would have been misleading, so it is recorded here as a discarded, confounded attempt instead.

What **is** honestly known: the code change is **STRUCTURAL REASONING**-verified correct (every existing and new test passes, including the exact multi-answer/offline-queue/reconnect/submit-while-pending scenarios in the Playwright suite) and structurally changes N sequential awaited round trips into N concurrent ones for a multi-answer flush — the general networking expectation (wall time approaching `max(latency)` instead of `sum(latency)` for a burst of same-destination requests over persistent HTTP connections) applies, but the actual magnitude through the real Data API/PostgREST path, from a real browser, was **not measured** in this session and is **UNVERIFIED**, not fabricated. The single-answer-per-flush case (the common one) is provably unaffected either way — one item dispatched via `Promise.all` behaves identically to one item awaited directly.

**Ranking confirmation, exactly as instructed:**
- `rank_test()` — **not modified**. No migration in this pass touches its body, and `20260913000002`/`000003` only change `EXECUTE` grants (a privilege change, not a function redefinition) — the REVOKE additionally means `rank_test` can now be called *less* often than before (anon/authenticated direct calls are no longer possible), never more, and never differently.
- `score_attempt()`'s ranking flow (its call into `rank_test`) — **not modified**, same reasoning.
- `submit_attempt()` — **not modified for ranking-optimization reasons or otherwise**. pgTAP test 9 in the new file explicitly confirms it still completes end-to-end (including its internal `score_attempt`→`rank_test` chain) exactly as before.

### 20.4 Remaining limitations (unchanged from Phase 0)

**True 80–100 concurrent application-path behavior remains UNVERIFIED** — nothing in this P1 pass attempted or claims to resolve that; it was explicitly out of scope per this task's instructions (no concurrency testing in this implementation phase). **`rank_test()` optimization remains deferred** — per instruction, it was not touched, redesigned, debounced, or queued; it remains the leading structural hypothesis from `performance-implementation-plan.md`, now with slightly reduced attack/DoS surface (Group B's revocation) but otherwise identical in behavior and performance characteristics to before this pass.

### 20.5 Follow-up correctness/reliability audit of the autosave and timer changes

A focused, read-only-first line-by-line audit of `attempt-client.tsx`/`exam-player.tsx` against `docs/exam-state-machine.md` found the concurrent-dispatch and clock-resync changes structurally sound on every checklist item — STRUCTURAL REASONING, cross-checked against passing tests: per-question `Map` keys prevent any shared-row race within one flush; the existing "drop only if unchanged since we started sending it" guard correctly protects against a same-question edit arriving while its previous save is still in flight, unaffected by sequential-vs-concurrent dispatch; `save_seq` remains a single strictly-increasing counter, satisfying the server's per-row monotonic guard regardless of dispatch order; `endRef` (the authoritative expiry instant) is never written to anywhere on the client, so no resync path — opportunistic (via `save_answer`'s response), periodic (3-minute `start_attempt` calls), or event-triggered (tab-visible/online) — can ever extend how long an attempt is considered valid; resync failures are silently ignored (no state change), degrading safely.

**One genuine, pre-existing gap was found and fixed** (present before this P1 work too — not introduced by the concurrent-dispatch or resync changes, though the concurrent dispatch's shorter flush duration made the window narrower, not wider): `submit()` calls `await flush()` before `submit_attempt`, but `flush()`'s guard against re-entrant calls returned an already-resolved no-op immediately if a flush was already in flight (e.g., started moments earlier by the 1500ms debounce timer) — instead of waiting for that in-flight round to actually finish. This meant a `submit_attempt` triggered right after a rapid answer change could race ahead of that answer's still-in-flight `save_answer` call. **Fix**: `flush()` now tracks its in-flight execution as a stored promise; a concurrent caller (`submit()`, or the debounce timer firing again) awaits that same promise instead of getting an immediate no-op. This is a minimal, targeted change — no new state machine transitions, no change to `save_seq`/retry/terminal-error semantics, no change to any RPC.

**Tests added** (all MEASURED — passing, confirmed on both a first run and a re-run against a freshly restarted dev server per the flake-verification protocol):
- `supabase/tests/050_autosave_timer_reliability.sql` (4 new pgTAP assertions, DB-level): four distinct questions in one attempt each persist their own independent row and keep distinct answers under a concurrent-shaped save pattern (the data-model guarantee the client's `Promise.all` dispatch relies on); `save_answer` past `expires_at` + transport grace is rejected with `attempt_expired` while the attempt is still `in_progress` — a specific error path (distinct from the already-covered post-submission `attempt_finalized` case) that wasn't previously exercised on its own.
- `tests/e2e/exam-engine.spec.ts` (2 new Playwright specs, browser-level — chosen because no unit/integration test runner exists in this project for React client logic, only pgTAP for the database and Playwright for the browser, per the existing, deliberate toolchain in `package.json`): answering three questions inside one debounce window and confirming all three persist after reload (exercises the concurrent-dispatch path end-to-end); submitting immediately after an unsaved answer change and confirming the resulting score reflects that answer, not a blank (exercises the exact race the `flush()` fix closes).

**Full suite after the fix**: typecheck PASS, lint PASS, pgTAP **63/63 PASS** (59 prior + 4 new), Playwright **7/7 PASS** (5 prior + 2 new). Playwright flaked twice more during this audit (once on an unrelated pre-existing test, once on one of the new tests) — both times reproducing only under a long-running dev-server process and passing cleanly both in isolation and on a full-suite re-run immediately after restarting the dev server, consistent with the dev-server/HMR staleness pattern already documented in §20.2, not a code defect (confirmed per the task's own flake-verification protocol: isolate → determine cause → restart if needed → re-run full suite → do not report a pass without confirming it).

**Ranking confirmation**: `rank_test()`, `score_attempt()`, `submit_attempt()`, and the exam state machine were not touched by this audit — the only production-code change was the `flush()` promise-tracking fix in `attempt-client.tsx`, and the only new files are tests.

## Phase 1 Gate Decision

**C. Testing incomplete — here is exactly what remains.**

This baseline is genuinely useful and mostly successful: it produced real, measured numbers for single-call RPC latency, autosave behavior, simultaneous-expiry handling, and — most importantly — it surfaced a previously-unknown, concretely measured constraint (the Supavisor session-mode `pool_size: 15` ceiling) that `performance-implementation-plan.md` had no way to know about. All existing tests remain green throughout (§2), and every synthetic artifact created was fully cleaned up and independently re-verified (§13).

However, it did **not** achieve the one thing it exists specifically to validate: true 80–100-simultaneous `submit_attempt` calls against the ranking bottleneck. The connection-pool ceiling — not the exam engine itself — is what capped this baseline's real concurrency at roughly 14–28 simultaneous connections. Before treating the `rank_test` serialization risk as either confirmed-at-scale or safely deprioritized, and before deciding how Phase 1's fix should be validated, this specific gap (§17, item 1–2) should be closed: either a way to sustain 80–100 real concurrent connections, or direct measurement through the application's actual PostgREST-based path, whichever is more practical to arrange next.

No Phase 1 code, schema, RPC, or configuration change was made as part of producing this report.
