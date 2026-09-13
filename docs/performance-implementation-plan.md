# MedVerse LMS — Performance Implementation Plan

**Status:** Planning document only. Nothing in this document has been implemented. No schema, migration, RPC, RLS, application code, dependency, Vercel, Supabase, or Cloudflare change has been made as part of producing this plan.

**Scope:** ~500 total students, 80–100 concurrent test-takers, occasional start/submission spikes on a single test. Not optimizing for hypothetical scale beyond this unless a specific finding below shows a current decision would block it.

**Evidence basis:** This plan supersedes the never-written `docs/performance-plan.md` — the intermediate research report was skipped by explicit user direction, and this document was built directly from (a) the canonical `docs/*.md` files, (b) direct reads of the relevant `supabase/migrations/*.sql` files and application source (line numbers cited throughout), and (c) live, read-only Supabase MCP calls against the project (`pxoxijlhcvbrostrquft`, `ap-southeast-1`, Postgres 17.6) — `list_tables`, `get_advisors` (performance + security, full JSON parsed), `list_extensions`.

**Critical limitation — read this before trusting any number below:** the live database currently holds **4 rows in `test_attempts` and 19 in `attempt_answers`**. This is a dev project, not a load-tested one. Every performance claim in this document is therefore labeled:
- **MEASURED** — observed directly (advisor output, row counts, extension list).
- **STRUCTURAL REASONING** — derived by reading the actual SQL/code and reasoning about locks, scans, and control flow (no query timing).
- **ESTIMATE** — order-of-magnitude reasoning about what would happen at 80–100 concurrent, not measured.
- **UNVERIFIED** — plausible but not checked in this session.

No p50/p95/p99 numbers exist yet for this system. Phase 0 (below) exists specifically to produce them before anything else is prioritized on faith.

---

## 1. Executive Summary

MedVerse's exam engine is architecturally sound for its stated goals: RLS is enabled everywhere, all exam mutations go through `SECURITY DEFINER` RPCs, concurrency safety for start/save/submit relies on unique indexes and single-row conditional `UPDATE`/`UPSERT` statements rather than application-level locking — a correct and idiomatic Postgres pattern. **STRUCTURAL REASONING**

There is exactly **one structural defect that gets worse, not just slower, as concurrency increases**: `score_attempt()` unconditionally calls `rank_test()` on every single submission, and `rank_test()` rewrites every submitted row of the test in one `UPDATE` statement. Under a burst of near-simultaneous submissions to the same test, these `UPDATE`s contend for the same rows and serialize; each one still does O(n) work. This is the one issue in this report that is a genuine correctness-adjacent concurrency risk (queueing/timeout risk under load), not just a tuning opportunity. **STRUCTURAL REASONING** — see §3/§8 for the alternatives analysis and recommendation.

Everything else found is real but lower-stakes: sequential (not batched) autosave RPC calls, no periodic timer re-sync, 20 non-exam functions with mutable `search_path`, 49 security-definer functions executable by `anon` at the grants level (standard Supabase default, hardenable), 25 unindexed FKs (mostly on catalog/admin tables, not the hot exam path), 50 "multiple permissive policy" pairs (all on catalog tables, not `test_attempts`/`attempt_answers`), and zero caching anywhere in the app (which is currently *correct by default*, not a gap — nothing here should be publicly cached).

**The single biggest gap is not a code defect: it's the absence of any load-test evidence.** Before committing engineering time to the P0/P1 items below, MedVerse should run Phase 0 (baseline instrumentation + a first load test) to confirm which of these structural risks actually manifest at 80–100 concurrent users, because the current dataset (4 attempt rows) cannot show that.

---

## 2. Findings Carried Forward (in place of the skipped performance-plan.md)

| # | Finding | Type | Source |
|---|---|---|---|
| 1 | `score_attempt()` always calls `rank_test()`, which rewrites every submitted row of the test | STRUCTURAL REASONING | `supabase/migrations/20260912000015_ranking.sql:36-100` (score_attempt), `:5-32` (rank_test) |
| 2 | `recompute_test()` already knows the "batch score, rank once" pattern; `score_attempt`'s per-submit path does not use it | STRUCTURAL REASONING | same file, `:104-164` |
| 3 | `auto_submit_expired()` bulk-updates state in one statement but then loops `score_attempt` per attempt — compounding finding #1 across a cron tick | STRUCTURAL REASONING | `20260912000013_exam_engine.sql:425-451` |
| 4 | Autosave flush sends one `save_answer` RPC per changed question, sequentially, in a `for` loop | MEASURED (direct code read) | `src/app/(student)/tests/[id]/attempt/attempt-client.tsx:88-129`, specifically the loop at `:95-118` |
| 5 | Exam countdown timer computes server/client clock skew once at mount; no periodic re-sync RPC | MEASURED (direct code read) | `src/components/exam/exam-player.tsx:79-100` |
| 6 | Cross-tab guard is entirely client-side (BroadcastChannel handshake); server enforcement is via `device_id`, not tab identity | MEASURED (direct code read) | `attempt-client.tsx:173-193` |
| 7 | 20 functions have mutable `search_path` — **none are exam-critical RPCs**; all are trigger/helper functions or pgTAP test fixtures | MEASURED (Supabase security advisor, parsed) | `sync_book_ancestors`, `sync_chapter_ancestors`, `sync_topic_ancestors`, `set_updated_at`, `default_tenant`, `sync_question_ancestors`, `forbid_version_mutation`, `validate_question_content`, `question_content_hash`, `normalize_stem`, `protect_published_test`, `protect_published_test_questions`, `as_user`, `as_runner`, `make_student`, `as_anon`, `make_question`, `make_curriculum`, `make_admin`, `make_published_test` |
| 8 | 49 security-definer functions (including admin-only ones) are EXECUTE-granted to `anon` at the Postgres grant level | MEASURED (Supabase security advisor, parsed) | includes `promote_student`, `publish_test`, `invalidate_test`, `close_test_now`, `create_question`, `import_question_batch`, `void_test_question`, `set_enrollment_status` |
| 9 | 25 unindexed FKs — concentrated on catalog/admin/audit tables, one on `test_attempts.invalidated_by` (rare-write, admin-only) | MEASURED (Supabase performance advisor) | `access_grants`, `audit_logs`, `books`, `chapters`, `enrollments`, `import_batches`, `import_rows`, `material_folders`, `practice_seen`, `question_versions`, `questions`, `test_attempts`, `test_audiences`, `test_questions`, `tests`, `topics` |
| 10 | 50 "multiple permissive policies" findings — all SELECT-role duplicate-policy pairs on catalog tables; `test_attempts`/`attempt_answers` are not flagged | MEASURED (Supabase performance advisor) | `books`, `chapters`, `topics`, `subjects`, `years`, `tests`, `enrollments`, `materials`, `material_folders`, `access_grants` |
| 11 | 6 unused indexes | MEASURED (Supabase performance advisor) | `practice_answers_question_version_idx`, `questions_topic_idx`, `questions_tags_gin`, `questions_stem_trgm`, `material_folders_year_idx`, `materials_folder_idx` — expected on a 4-row dev DB; not evidence they're actually unneeded in production |
| 12 | No app-level caching anywhere (`revalidatePath` only on admin mutation actions; no `unstable_cache`/`revalidateTag`/fetch cache options found); every server-side Supabase client calls `cookies()`, which forces dynamic rendering by default | MEASURED (direct code read, prior session exploration) | `src/lib/supabase/server.ts`, `src/lib/actions/*.ts` |
| 13 | All three Supabase clients (browser/server/admin) talk to the Data API (PostgREST) URL, not a direct Postgres connection string; `config.toml`'s `[db.pooler]` block is local-CLI-only | MEASURED | `src/lib/supabase/{client,server,admin}.ts`, `supabase/config.toml` |
| 14 | `pg_stat_statements`, `pg_cron`, `pgtap` installed; `pg_stat_monitor`, `hypopg`, `index_advisor`, `pg_prewarm` available but not installed | MEASURED (`list_extensions`) | — |
| 15 | Vercel region `sin1`, Supabase region `ap-southeast-1` (Singapore) — both in the same metro, effectively co-located; Pakistan-to-Singapore is the actual network hop, not Vercel-to-Supabase | MEASURED (`vercel.json`, `get_project`) | — |

---

## 3. P0 Changes

P0 = must happen before this system can be trusted for a real 80–100-concurrent exam event.

| # | Recommendation | Evidence | Risk if skipped | Complexity | Expected impact |
|---|---|---|---|---|---|
| P0-1 | **Run Phase 0 baseline instrumentation + first load test before any other change.** Nothing below can be validated without real timing data — the dev DB has 4 rows. | Finding: no measurements exist | High — every subsequent priority call is a guess without this | Low (no code change, just running tests against a seeded copy) | Turns every ESTIMATE below into MEASURED |
| P0-2 | **Decouple `rank_test()` from the synchronous per-submission path** (mechanism TBD in §8 alternatives analysis — recommendation: debounced/coalesced per-test recompute, not queues/Redis) | STRUCTURAL REASONING, findings #1–#3 | Under a real 100-student simultaneous submission window, this is the one thing that can turn "slow" into "students see submission errors/timeouts" | Medium (one RPC + one scheduling mechanism, no new infra) | Removes O(n²) row-lock serialization from the exam-critical path |

Nothing else qualifies as P0 — everything else is a tuning or hardening opportunity, not a thing that threatens exam-day reliability at this scale, based on the evidence gathered.

---

## 4. P1 Changes

**Status: P1-1, P1-2, P1-3, and P1-4 have all been implemented** — see `docs/performance-baseline.md` §20 for the full implementation record, evidence, tests, and an honest (not fabricated) performance-regression check. `rank_test()`/`score_attempt()`/`submit_attempt()` were not modified in any way, per the P1 execution's explicit change control. Phase 0's gate remains **C — INCOMPLETE**; none of this touches the still-unverified 80–100 concurrent application-path question.

| # | Recommendation | Evidence | Risk | Complexity | Expected impact | Status |
|---|---|---|---|---|---|---|
| P1-1 | Batch autosave into a single multi-answer RPC call (or at minimum parallelize the sequential loop) | MEASURED, `attempt-client.tsx:95-118` | Low correctness risk if done carefully (see §5 analysis — must preserve `save_seq` semantics) | Medium | Fewer round trips per flush under a burst of answer changes near submission time | **Implemented as concurrent dispatch of the existing `save_answer` RPC** (`Promise.all`), not a new batched RPC — a true single-RPC payload batch would have required an RPC/schema change, which was explicitly out of scope per the implementation task; see `performance-baseline.md` §20.1/§20.3 for why, and for the honest note that the real-world latency magnitude remains unmeasured (a synthetic attempt was confounded and discarded rather than reported) |
| P1-2 | Harden the 20 mutable-`search_path` functions (`SET search_path = public` or `pg_catalog, public`) | MEASURED, security advisor | Low (trigger/helper functions, not exposed to untrusted input directly, but still best practice) | Low (one migration touching function definitions only) | Closes a defense-in-depth gap; no behavior change | **Implemented** for the 12 production `public`-schema functions (`supabase/migrations/20260913000001_search_path_hardening.sql`, `ALTER FUNCTION ... SET`, no body changes). The other 8 flagged functions live in the pgTAP-only `test_helpers` schema, never exposed via the Data API — left alone as out of scope for a production migration |
| P1-3 | `REVOKE EXECUTE ... FROM anon` on admin-only RPCs (`promote_student`, `publish_test`, `invalidate_test`, `close_test_now`, `create_question`, `import_question_batch`, `void_test_question`, `set_enrollment_status`, etc.) | MEASURED, security advisor | Low — these already check `is_admin()` internally; this is defense-in-depth, not a fix for a live vulnerability | Low | A bug in one function's internal check no longer becomes directly anon-exploitable | **Implemented and extended beyond the original example list** (`20260913000002`/`000003_revoke_*.sql`): 15 admin-only RPCs plus `log_audit` lost `anon` access (kept `authenticated`) — `log_audit`'s remaining authenticated-non-admin gap was subsequently remediated by `20260913000004_log_audit_admin_only.sql`, see `performance-baseline.md` §20.1; `score_attempt`/`rank_test`/`recompute_test`/`finalize_if_expired`/`auto_submit_expired` — found during the audit to have **no legitimate direct caller at all** — lost both `anon` and `authenticated` access. Required a follow-up migration after verification showed Postgres's default `PUBLIC` grant was still giving every role effective access; see `performance-baseline.md` §20.1 for the full verify→fix→re-verify sequence. New pgTAP coverage added (`supabase/tests/040_security_hardening.sql`) |
| P1-4 | Add a periodic (not per-keystroke) server-time re-sync for the exam countdown | MEASURED, `exam-player.tsx:79-100` | Low — current display-only drift on long-sleeping tabs; actual expiry is still server-enforced via `expires_at`/30s grace, so no scoring/security risk today | Low | Removes the (currently cosmetic) risk of a displayed countdown drifting from actual server expiry on laptop-sleep-type scenarios | **Implemented**: opportunistic resync from every `save_answer` response (free), a 3-minute periodic fallback via `start_attempt` (already idempotent, already returns `server_now` — no new RPC), plus an immediate resync on tab-visible/online events. Server-side expiry authority (`expires_at`, transport grace, finalization sweep) is completely untouched |

---

## 5. P2 Changes

| # | Recommendation | Evidence | Notes |
|---|---|---|---|
| P2-1 | Add indexes for FKs **only where a real query pattern is identified** (see §7's per-index table) — not all 25 automatically | MEASURED, performance advisor | The `0021_perf_indexes.sql` migration shows the team already does this reactively (added 3 indexes because specific analytics RPCs needed them) — continue that evidence-driven pattern |
| P2-2 | Consolidate the 50 multiple-permissive-policy pairs on catalog tables (merge `_admin_all`/`_admin_write` + `_student_select` into one policy with an `OR` predicate, or use `RESTRICTIVE` policies) | MEASURED, performance advisor | Catalog tables are read-heavy but low-write and low-row-count; benefit is real but marginal at this scale — do after P0/P1 |
| P2-3 | Materialize `test_summary`/`test_leaderboard` (or cache with short TTL) **only if Phase 0/5 load testing shows them expensive** | STRUCTURAL REASONING | Currently computed live per admin page view; at 100 attempts this is a trivial aggregate — do not materialize preemptively |
| P2-4 | Remove the 6 unused indexes **only after confirming via production-like data that they stay unused** — a 4-row dev DB proves nothing | MEASURED, performance advisor | Premature on current evidence |

---

## 6. Future Changes (P3 / explicitly deferred)

| # | Item | Classification | Why |
|---|---|---|---|
| F-1 | Read replicas | NOT NEEDED | Single-region, <500 users, read load is not the bottleneck found |
| F-2 | Region migration off `ap-southeast-1`/`sin1` | NOT NEEDED (pending evidence) | See §9 — no measured latency problem exists yet |
| F-3 | Redis / external cache | NOT NEEDED | `docs/architecture.md` explicitly excludes it; nothing found requires cross-request shared mutable state beyond what Postgres already provides |
| F-4 | Queues / background workers | NOT NEEDED | The one job that looked queue-shaped (ranking) has a simpler in-Postgres solution — see §8 |
| F-5 | WebSockets | NOT NEEDED | No real-time requirement found beyond the 500ms client-local countdown and admin live-monitoring, both servable by polling/RLS reads |
| F-6 | Separate backend / Ubuntu VPS / SSH-managed server | NOT NEEDED | Nothing found that Next.js Server Actions + Postgres RPCs cannot do |
| F-7 | Cloudflare (Workers/R2/WAF/rate limiting/CDN) | NOT NEEDED — see §10 | Vercel's CDN + Supabase already cover the identified needs at this scale |

---

## 7. Database Implementation Plan

### 7.1 The `rank_test()` decoupling (P0-2) — see §8 for the full alternatives analysis and final recommendation

### 7.2 Per-index evaluation (only where justified — not blanket FK-index addition)

| Table / Query | Current behavior | Problem | Proposed change | Expected benefit | Write/storage cost | Security implications | Migration required | EXPLAIN ANALYZE validation | Rollback |
|---|---|---|---|---|---|---|---|---|---|
| `test_attempts.invalidated_by` (FK, unindexed) | Sequential scan if ever filtered/joined on this column | Admin-only, rare-write, rare-read (only on the kill-switch audit view) | **Do not add** unless Phase 0 finds a slow admin query joining on it | None currently justified | N/A | None | N/A | N/A | N/A |
| `question_versions.created_by`, `questions.created_by`/`book_id`/`current_version_id`/`year_id` (unindexed FKs) | Sequential scans possible on admin question-bank browsing/filtering | These back admin content-management screens, not the exam-critical path | Add composite/FK indexes **only for the specific queries Phase 0/5 shows as slow** (e.g. `question_difficulty_report`, `admin_student_profile` — the same pattern `0021_perf_indexes.sql` already used) | Faster admin analytics pages | Small (few hundred rows currently; will grow with question bank) | None | Yes, one migration, additive only | `EXPLAIN ANALYZE` the specific admin RPC before/after | `DROP INDEX` — fully reversible, no data risk |
| `test_attempts_score_idx (test_id, score desc)` (existing) | Already supports `rank_test`'s ORDER BY partially | Doesn't cover `submitted_at`, the secondary sort key | Consider extending to `(test_id, score desc, submitted_at asc)` **only if Phase 0 shows the sort step in `rank_test`'s plan is a bottleneck** — the real cost there is the row-lock serialization (§3), not the sort | Marginal — the UPDATE-lock issue dominates | Small | None | Yes | `EXPLAIN ANALYZE` on `rank_test`'s internal CTE via a temporary wrapper query | Reversible |
| 50 multiple-permissive-policy pairs on catalog tables | Postgres evaluates both policies per row per query | Real but small at current row counts (tens of rows in `books`/`chapters`/`topics`) | Merge into single `OR`-combined policies per table (P2-2) | Marginal query-planning overhead removed | None (policy rewrite, no new storage) | **Must verify merged predicate is logically identical** — this is a security-sensitive change, do via migration + pgTAP regression test, not ad hoc | Yes | Compare `EXPLAIN (ANALYZE, BUFFERS)` before/after on a representative catalog query | Revert migration; policies are declarative and easy to re-split |
| 6 unused indexes | Never hit by planner (per advisor, on a 4-row DB) | Not enough evidence to say they're actually dead in production | **Do not drop yet** — re-check after Phase 0's seeded load test | N/A | Currently near-zero (small tables) | None | N/A until re-evaluated | Re-run advisor after load test | N/A |

**General rule applied throughout this section, per explicit instruction:** no index is proposed solely because the FK-index advisor flagged it. Each either ties to a specific admin RPC already known to join on that column, or is explicitly deferred pending Phase 0 evidence.

---

## 8. Exam-Engine Implementation Plan

### 8.1 Ranking: full alternatives analysis (per explicit instruction — no mechanism pre-selected)

**Constraint restated:** ranking semantics must not change — `RANK() OVER (ORDER BY score DESC, submitted_at ASC)` tie behavior, the percentile formula (`round(100*(n-r)/(n-1),2)`, n≤1 → null-handling per `20260912000025_percentile_unranked_for_n1.sql`), and `state <> 'invalidated'`/`state = 'submitted'` filtering must all be byte-for-byte preserved. Only *when* the `rank_test` computation runs relative to an individual `submit_attempt` call may change.

| Option | Correctness | Freshness | Concurrency behavior | Transaction behavior | Failure behavior | Retry | Impl. complexity | Ops complexity | Effect on result page | Effect on leaderboard | Effect on 100 simultaneous submissions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **A. Rank synchronously during submission (current)** | Correct | Always instantly fresh | Every submit takes a full-table write lock — **this is today's behavior and the identified bottleneck** | Rank update is inside the same transaction as scoring | If ranking fails, whole submit fails (student sees an error even though their score was computed) | Client retries `submit_attempt`, which is idempotent, but retries would re-attempt the same expensive rank | None (already built) | None | Rank shown immediately on the result page | Always current | **Serializes; O(n²) total row-writes across the burst** |
| **B. Rank per-submission but with explicit locking (e.g. `pg_advisory_xact_lock(test_id)`)** | Correct | Always fresh | Makes the serialization *explicit and ordered* instead of implicit lock-wait, but doesn't reduce total work — still O(n) work per submit, O(n²) total | Same transaction | Same as A | Same as A | Low (one extra line) | None | Same as A | Always current | Same total cost as A, just with predictable ordering instead of random lock-wait order — **does not fix the throughput problem, only its fairness** |
| **C. Debounced/coalesced per-test ranking** (rank at most once per short window per test, e.g. via a `dirty_tests` marker table + a lightweight `pg_cron` job every few seconds, or a "rank if not ranked in last N seconds" guard inside `score_attempt` itself) | Correct — final state converges to the same ranks; only *intermediate* staleness during the debounce window | Rank/percentile may lag by a few seconds during a submission burst, then catch up | Submission burst no longer each pays the O(n) rank cost — one coalesced rank pays it once per window | Scoring stays synchronous (student's score is always immediate and correct); ranking becomes decoupled | If the debounced rank job fails, next tick retries; scores are never lost, only rank temporarily stale | Natural (next cron tick) | Low-medium (one small helper table/flag + a `pg_cron` schedule, no new extension) | Low (already have `pg_cron` installed and in use) | Score always correct immediately; rank/percentile may show "updating…" for a few seconds right after submitting during a burst — acceptable given results are typically viewed after, not during, the burst | Same brief staleness, self-healing | **Fixes the bottleneck: O(n) total rank work regardless of burst size, submission latency unaffected by other students' submits** |
| **D. Cron/background ranking only (no per-submit trigger at all)** | Correct, but rank can be stale for up to a full cron interval (currently 1 minute via existing `auto_submit_expired` cron) even for early, isolated submissions outside a burst | Worse freshness than C for the common case (a single student submitting outside a rush) | No lock contention from submissions at all | Scoring synchronous, ranking fully decoutpled | Same as C | Natural | Low (reuse existing pg_cron infra) | Low | A student submitting alone could see "rank pending" for up to a minute — worse UX than C for the non-burst case | Same | Fixes the bottleneck, but at a worse freshness cost than C for the common (non-burst) case |
| **E. Incremental ranking** (maintain rank via an insert-time computation instead of a full window-function rewrite, e.g. tracking a sorted structure) | High implementation risk — Postgres has no native incremental window-function primitive; would require hand-rolled logic (e.g., binary-search insert position + shifting affected ranks) that is easy to get subtly wrong against tie-breaking rules | Always fresh | Still touches every row whose rank shifted (which, for a rank inserted near the top, can be most of the table) — no fundamental complexity-class improvement over A for a table that's mostly re-ranked by a top-of-pack insert | Complex to keep transactionally correct | High bug surface — a missed edge case corrupts every rank below the affected point, silently | Hard to retry safely (partial incremental updates are dangerous) | High | High (custom logic to test, maintain, audit against tie-break rules) | Same as A instantly | Same as A instantly | Does not reliably fix the underlying contention (same rows still get touched); high risk for the invariant-preservation requirement — **not recommended** |
| **F. Materialized/cached ranking (e.g., a separate `test_rankings` snapshot table refreshed periodically, read by the leaderboard/result pages instead of `test_attempts.rank` directly)** | Correct if refresh logic mirrors `rank_test` exactly | Deliberately stale between refreshes (same tradeoff as C/D, but adds a second table to keep in sync) | Submission path fully decoupled — writes to `test_attempts` never touch a ranking table at all | Separate refresh transaction | If refresh fails, leaderboard shows a stale snapshot but scores are unaffected | Natural (next refresh) | Medium-high (new table + refresh function + dual-source-of-truth risk: is `test_attempts.rank` or the materialized table now authoritative?) | Medium (one more object to maintain/monitor) | Requires the result page to read from a different source than today, or duplicate logic | Requires the leaderboard RPC to change its source table | Fixes the bottleneck but with more moving parts and a genuine dual-source-of-truth risk that options C/D avoid by keeping `test_attempts.rank` as the single source | 
| **G. Queues/Redis/background workers** | N/A | N/A | N/A | N/A | N/A | N/A | High — new infrastructure category | High — new infrastructure category, explicitly excluded by `docs/architecture.md` | N/A | N/A | **Not evaluated further — the workload (rank a few hundred rows, once, a few times a minute) does not justify new infrastructure; explicitly rejected per architecture.md's exclusion list and the instruction not to introduce infra unless proven necessary** |

**Recommendation: Option C — debounced/coalesced per-test ranking, implemented entirely in Postgres using the already-installed `pg_cron` (no new extension, no new infrastructure category).**

Sketch of the mechanism (for the next planning/implementation pass — not implemented here): `score_attempt` keeps scoring synchronously as it does today (this is cheap — a single-attempt aggregate), but stops calling `rank_test` directly. Instead it sets a lightweight "this test needs re-ranking" marker (e.g., an `UPDATE tests SET rank_dirty_at = now() WHERE id = ...` or a small dedicated table), and a `pg_cron` job running every few seconds picks up tests whose marker is set and calls `rank_test` once per test per tick, clearing the marker. This means:
- A burst of 100 submissions to the same test within a few seconds triggers **one** `rank_test` call for that window, not 100.
- An isolated submission still gets ranked within one cron tick (a few seconds — far better than option D's full-minute interval, and no worse than option A's "instant" in any way that matters for a result page a student checks after submitting).
- No new source-of-truth ambiguity: `test_attempts.rank`/`.percentile` remain the only columns anyone reads, exactly as today.
- No ranking semantics change at all — `rank_test`'s body is untouched.

This should be validated in Phase 0/5 (load test showing submission latency and DB lock-wait time before/after) before being treated as final.

### 8.2 Autosave batching (P1-1)

Current: `attempt-client.tsx:88-129` debounces 1500ms then flushes via a `for` loop issuing one `save_answer` RPC per changed question, sequentially, with per-entry drop-on-success and a 4s-backoff retry on any failure that isn't a terminal state error.

Analysis:
- **Request reduction**: real, but the debounce already caps how often flushes happen; the actual waste is N RPCs *within* one flush when a student has changed multiple questions since the last flush (e.g., using the question palette to jump around, or a burst right before submitting). This is the case worth fixing.
- **Failure/retry/idempotency**: the current per-question sequential approach has a nice property — a failure on question 3 doesn't block questions 1-2 from having already saved, and the retry loop only re-sends what's still in `pendingRef`. A single batched multi-answer RPC would need to preserve this partial-success semantic (e.g., return per-question success/failure in its JSON response) or it *regresses* durability if a batch fails atomically and previously-would-have-saved answers are lost.
- **`save_seq` semantics**: must remain per-question monotonic; a batched RPC would need to accept an array of `(question_version_id, selected_key, marked_for_review, save_seq)` tuples and apply the same `WHERE attempt_answers.save_seq < excluded.save_seq` guard per row — mechanically straightforward in a single `INSERT ... SELECT ... ON CONFLICT` from `jsonb_to_recordset`, but must be tested against the exact partial-failure/retry scenarios in `docs/exam-state-machine.md`'s failure-coverage table before shipping.
- **Verdict**: justified as a P1 (not P0) — real but bounded network-request reduction, not a correctness or exam-day-reliability fix. Should not be done in a way that sacrifices the current partial-success durability property; a batched RPC must return granular per-answer results, not a single pass/fail.

### 8.3 Timer re-sync (P1-4)

Current: `exam-player.tsx:79-100` computes `skew = serverNowMs - Date.now()` once at mount, then a 500ms local `setInterval` recomputes `msLeft` from `Date.now() + skew` against the frozen `expiresAtMs`.

Analysis:
- **Is it needed?** The *displayed* countdown can drift from true elapsed time only in scenarios where `Date.now()` itself becomes unreliable relative to wall-clock time on the client (e.g., a laptop suspend/resume, or an OS clock adjustment) — the skew captured at mount no longer holds. This is a display/UX issue only: actual expiry enforcement is 100% server-side (`expires_at` + 30s transport grace on `save_answer`/`submit_attempt`, `finalize_if_expired`), so a drifted display cannot cause a security or scoring problem — it can only show a wrong countdown or cause auto-submit to fire client-side at a slightly wrong local moment (harmless, since the server independently enforces the real deadline and will reject/auto-finalize correctly regardless).
- **Recommendation**: add a periodic re-sync (e.g., piggyback on the existing `save_answer` flush responses, which already return `server_now` — no new RPC needed) every flush or every ~60s, whichever is less frequent, recomputing `skew` from that response instead of adding a dedicated polling endpoint. This adds zero new network traffic (reuses existing autosave round trips) while fixing the drift.
- **Exam timing semantics**: unchanged — this only affects the client's *display and self-triggered submit timing*, never the server's authoritative `expires_at` check.

---

## 9. Vercel / Next.js Implementation Plan

### 9.1 Caching matrix

| Category | CDN cache? | Browser cache? | Next.js Data Cache? | ISR? | Revalidation | no-store? |
|---|---|---|---|---|---|---|
| Public/marketing pages (`/`, `/login`, `/register` shell) | Yes (static) | Yes | Static render | Not needed (rarely changes) | On deploy | No |
| Curriculum/study-materials metadata (years/subjects/books listing, non-personalized) | **No** — access is enrollment-gated via RLS, so "public" curriculum data is actually per-student-visible-subset, not truly public | Short browser cache acceptable | Could use per-user dynamic render; **do not** promote to a shared/CDN cache since visibility depends on `has_active_enrollment()` | No | N/A | Effectively yes (dynamic, per-request) |
| Student dashboard, upcoming tests | **No** (authenticated, personalized) | No | No | No | N/A | **Yes — no-store** |
| Active exam page (`start_attempt` payload, questions, timer) | **Never** | **Never** | **Never** | **Never** | N/A | **Yes — no-store, always** |
| Answer submission (`save_answer`/`submit_attempt`) | **Never** | **Never** | **Never** | **Never** | N/A | **Yes — no-store, always** |
| Student results | **Never** (personal score data) | No | No | No | N/A | **Yes — no-store** |
| Leaderboard | **Never publicly/shared** — per-test, per-enrollment-gated, includes other students' names/scores | No | Per-request only, if any | No | N/A | **Yes — no-store** (freshness also matters given §8's debounced ranking) |
| Admin dashboard / admin analytics | **Never** | No | No | No | N/A | **Yes — no-store** |
| Static assets (JS/CSS/fonts/images) | Yes — Vercel's default immutable asset caching already applies via Next.js build output | Yes (long-lived, hashed filenames) | N/A | N/A | On new deploy (new hash) | N/A |

**Explicitly never cacheable, publicly or via shared cache, per this analysis:** active exam state, in-progress answers, correct answers before disclosure, student scores, private student data, admin data, authentication/session data. **This matches current behavior already** (finding #12) — every server-side data read forces dynamic rendering today via `cookies()`. **No caching gap exists to close; the current all-dynamic default is the correct posture for this data sensitivity profile.** The only opportunity is the already-correctly-static marketing shell and already-correctly-immutable build assets, both of which Next.js/Vercel already handle by default with no custom configuration found or needed.

### 9.2 What NOT to do

Do not introduce ISR or ad hoc `unstable_cache`/ `ourselves-managed` caching for dashboard/results/leaderboard pages merely to shave latency — every one of those pages carries either personalized or access-gated data, and the correctness cost (a cached page showing a stale score, or worse, another student's leaked data via a misconfigured shared cache key) outweighs a marginal latency win at this scale. If dashboard load time becomes a measured problem in Phase 0/5, the fix is query/index optimization (§7), not caching personalized data.

---

## 10. Security Hardening Plan

Explicitly separated from performance (per instruction — these are two different problems even though some share the same functions).

| Item | Type | Action | Security benefit | Performance benefit |
|---|---|---|---|---|
| 20 mutable-`search_path` functions | Security hardening | Add `SET search_path = public` (or `pg_catalog, public`) to each, in a migration | Closes a `search_path`-hijack vector for `SECURITY DEFINER`/trigger functions that don't already pin it (the exam-critical RPCs already do this correctly) | None |
| 49 anon-executable security-definer functions (incl. admin RPCs) | Security hardening | `REVOKE EXECUTE ON FUNCTION ... FROM anon` for admin-only functions (keep `authenticated` grant, since `is_admin()` still gates the actual logic) | Defense-in-depth: removes the ability for an *unauthenticated* Postgres role to even attempt calling `promote_student`/`publish_test`/etc., independent of their internal `is_admin()` check | None |
| RLS policy structure (multiple permissive policies) | **Performance**, not security | See §5 P2-2 — do not conflate with the above | N/A | Marginal query-planning overhead reduction on catalog tables |
| RLS predicates generally | Already following best practice | No change needed — confirmed `(select auth.uid())` subselect form used throughout (planner-cacheable), `SECURITY DEFINER` helper functions used consistently rather than inlined joins | N/A | N/A |
| Auth: leaked-password protection disabled | Security (Supabase Auth setting, not app code) | Flag for the user to enable in Supabase Auth settings — **out of scope for this document to change**, since it's a dashboard/config setting, not code | Standard hardening | None |

**Never:** disable RLS, bypass RLS client-side, expose the service-role key beyond `src/lib/supabase/admin.ts` (already correctly marked `server-only` and used only by the cron route), or weaken any `is_admin()`/`can_access_test()`/`is_active_session()` check.

---

## 11. Observability Plan

Given `pg_stat_statements` is already installed (finding #14) but nothing consumes it yet:

- **Application**: request latency and errors already surface via Vercel's built-in function logs/analytics — no new product needed at this scale. Add structured logging around `submit_attempt`/`save_answer` failures specifically (these currently only surface as toast messages client-side; log them server-side too, e.g. via a lightweight audit-adjacent table or Vercel log drains) so exam-day submission failures are visible without waiting for a student to report one.
- **Database**: query `pg_stat_statements` before/after each optimization (this is the mechanism for every "EXPLAIN ANALYZE validation" cell in §7) instead of adding a new paid product. Track `test_attempts`/`attempt_answers` table bloat/vacuum stats during load tests given the high `UPDATE` churn from `rank_test`.
- **Exam engine**: track (via a simple query, not new infra) count of `in_progress` attempts nearing `expires_at`, count of `auto_submit_expired` finalizations per cron tick, and rank-staleness (time since last `rank_test` call per test) if Option C (§8.1) is implemented — this last one is a natural health check for the debounce mechanism itself.
- **Infrastructure**: Vercel's existing deployment/error dashboards are sufficient at this scale; no additional product justified.

Do not add a paid observability product (Datadog, Sentry, etc.) without first confirming `pg_stat_statements` + Vercel's built-in logs are insufficient — no evidence yet that they are.

---

## 12. Load-Testing Plan

Concurrency steps: 10, 25, 50, 100, 150, 250 (500 as an optional stress test beyond the current target).

**Most important scenario**: 100 students on one test, submitting within a narrow window (models the real peak this system must survive).

Scenarios to script: login, dashboard load, test launch (`start_attempt`), question retrieval, autosave bursts, refresh mid-exam, reconnect after simulated network loss, simultaneous submission, simultaneous expiry (`auto_submit_expired` cron tick with many expired attempts at once), result page load, leaderboard load, admin live-monitoring page load.

Metrics, **BASELINE (current code) vs. POST-OPTIMIZATION (after §3/§8 changes)**:
- p50/p95/p99 for `start_attempt`, `save_answer`, `submit_attempt` RPC latency specifically (not just page load)
- Error rate (RPC errors, not just HTTP errors)
- Database CPU and active connections during the submission burst
- Lock-wait time on `test_attempts` (directly tests whether §8.1's fix works — this is the number to watch)
- Request volume and duplicate-write counts (verifies idempotency holds under retry storms)
- Answer-save and submission failure counts (should be ~0 in both baseline and post-optimization, since correctness must never regress — only latency should improve)

Recommended tooling: since there's no existing load-testing tool in `package.json`, and Playwright is already the E2E framework in use, a k6 or Artillery script hitting the Supabase RPC endpoints directly (bypassing the browser) is more representative of raw RPC/DB load than driving 100 real Playwright browser instances; Playwright remains appropriate for the *functional* correctness scenarios (refresh/reconnect/multi-tab) at low concurrency, run separately from the throughput test.

---

## 13. Regression-Testing Plan

Before and after any change in §3/§4:
- Re-run `npm run test:db` (pgTAP, wrapped in `BEGIN/ROLLBACK`) — must cover scoring, ranking (tie-break + percentile + n≤1), and the exam state machine's failure-coverage table per `docs/exam-state-machine.md`.
- Re-run `npm run test:e2e` (Playwright) for the full exam lifecycle including refresh/multi-tab/multi-device scenarios per `docs/test-rules.md`/`medverse-qa` skill.
- Any change to `rank_test`'s call site (§8.1) must be verified against a scripted scenario reproducing tie scores and n=1 to confirm the percentile/rank output is byte-identical before and after.
- Any change to `save_answer` batching (§8.2) must be verified against the documented failure-coverage table (refresh, offline, partial batch failure, out-of-order arrival) — not just the happy path.

---

## 14. Rollback Strategy

- All proposed DB changes are additive (new indexes, `search_path` pins, `REVOKE EXECUTE`) or narrowly scoped (the ranking-trigger relocation) — each is a single forward migration with a corresponding reverse migration (`DROP INDEX`, re-`GRANT EXECUTE`, revert `score_attempt`'s body to call `rank_test` directly).
- The ranking change (§8.1, Option C) should ship behind a condition that's trivially reversible: if the debounced cron approach misbehaves, reverting `score_attempt` to call `rank_test` synchronously (today's behavior) is a one-function `CREATE OR REPLACE FUNCTION` rollback with no data migration needed, since `test_attempts.rank`/`.percentile` remain the same columns throughout.
- No proposed change alters `test_attempts`/`attempt_answers` schema shape, so no data backfill/rollback risk exists for the exam-critical tables.

---

## 15. Final Implementation Order

1. **Phase 0 — Baseline & instrumentation.** Seed a realistic-scale copy of the schema (hundreds of attempts across a handful of tests), enable `pg_stat_statements` tracking, run the Phase 5 load test *before* changing anything, and record real p50/p95/p99 + lock-wait numbers. This turns every ESTIMATE in this document into MEASURED before more work is prioritized on assumption.
2. **Phase 1 — Critical exam-path optimization.** Implement §8.1's Option C (debounced/coalesced ranking) and re-run the same load test to confirm the lock-wait/serialization finding is actually fixed.
3. **Phase 2 — Database optimization.** Apply only the §7 indexes that Phase 0/1's actual query plans justify; apply the security-adjacent `search_path` fixes (§10) in the same pass since they're low-risk, additive migrations.
4. **Phase 3 — Autosave & timer improvements.** §8.2 batching and §8.3 timer re-sync — lower urgency, can follow once the ranking fix is validated.
5. **Phase 4 — Caching/Next.js.** No changes expected here per §9's analysis (current all-dynamic posture is already correct) — this phase is a confirmation pass, not a build pass, unless Phase 0 surfaces an unexpected dashboard-latency problem.
6. **Phase 5 — Security hardening.** `REVOKE EXECUTE` on admin RPCs (§10) — independent of performance work, can run in parallel with any of the above.
7. **Phase 6 — Full load test + regression suite.** Re-run the Phase 0 load test post-all-changes for a direct before/after comparison, plus full `test:db`/`test:e2e` regression per §13.

---

## 16. Definition of Done

**Exam reliability**: no lost answers under the documented failure scenarios (refresh, offline, multi-tab, multi-device, network loss) — verified via `test:e2e`/`medverse-qa` manual procedures, not assumed. No duplicate submissions. No incorrect scores (verified via pgTAP against the exact marking formula). No ranking corruption (tie-break/percentile/n≤1 outputs byte-identical before/after any ranking-timing change).

**Performance**: p95 submission latency for a 100-concurrent-submission burst measured and acceptable (specific target number TBD from Phase 0's baseline — do not invent one now); lock-wait time on `test_attempts` during a submission burst measured near-zero post-Option-C (vs. measurable pre-fix).

**Security**: RLS remains enforced everywhere (no policy relaxed); no sensitive data (active exam state, answers, scores, admin data) ever cacheable in a shared/CDN cache; service-role key usage remains confined to `src/lib/supabase/admin.ts`; admin RPCs no longer `anon`-executable at the grant level.

**Concurrency**: `test_attempts_one_live` unique-index guard against duplicate attempts still holds; `save_seq` monotonic guard still holds under batched autosave; device-binding checks unchanged.

**Resilience**: refresh, reconnect, and network-interruption scenarios from `docs/exam-state-machine.md`'s failure-coverage table still pass after every change; auto-submit (`auto_submit_expired`) remains safe and idempotent.

**Data integrity**: attempt state machine (3 states, 5 transitions) unchanged; question-version freezing (`test_questions` snapshot at publish) unchanged; audit logging on all admin mutations unchanged.

**Caching correctness**: nothing personalized or exam-sensitive is ever served from a shared/CDN cache — verified by inspecting response headers for every route in §9.1's matrix.

**Observability**: `pg_stat_statements`-based before/after comparison exists for every §7/§8 change; exam-critical failure counts (answer-save failures, submission failures, auto-submit failures) are visible without waiting for a support ticket.

---

## Final Summary

**A. Top 5 changes that should actually be implemented**
1. Phase 0 baseline load test — everything else depends on this existing first.
2. Decouple `rank_test()` from the synchronous submission path (Option C: debounced/coalesced per-test ranking via `pg_cron`, no new infrastructure).
3. Harden the 20 mutable-`search_path` functions and `REVOKE EXECUTE FROM anon` on admin-only RPCs — cheap, low-risk, real defense-in-depth.
4. Batch the autosave flush (preserving per-question partial-success semantics) to cut sequential RPC calls during answer bursts.
5. Add the handful of FK indexes that Phase 0's actual query plans (not the blanket advisor list) show are hit by real admin/analytics queries.

**B. Things that should NOT be added**
Redis, queues/background workers, WebSockets, a separate backend, Cloudflare (Workers/R2/WAF/rate limiting/CDN), region migration, materialized ranking tables, or any caching of personalized/exam-sensitive data. None of the evidence gathered justifies any of these at 80–100 concurrent users, and `docs/architecture.md` already explicitly excludes most of them.

**C. Biggest remaining technical risk**
The `score_attempt()` → `rank_test()` full-table-rewrite-per-submission pattern. It is the one finding in this entire review that scales *worse than linearly* with concurrent submissions, and it is currently **unverified by any real load test** — it is a structural-reasoning finding, not yet a measured one.

**D. Recommended implementation order**
Phase 0 (baseline) → Phase 1 (ranking fix) → Phase 2 (DB/security) → Phase 3 (autosave/timer) → Phase 4 (caching confirmation, likely a no-op) → Phase 5 (security hardening, parallelizable) → Phase 6 (final load test + full regression).

**E. Exact tests required before production**
`npm run test:db` (pgTAP) and `npm run test:e2e` (Playwright) both green; a scripted load test (k6/Artillery against the RPC layer) covering 10/25/50/100/150/250 concurrent, with the 100-simultaneous-submission scenario as the pass/fail gate; a manual pgTAP-or-scripted check that rank/percentile/tie-break output is byte-identical before and after the ranking-timing change.

**F. Is the current architecture sufficient for 80–100 concurrent students?**
**Architecturally sufficient, with one identified fix required first — not yet empirically verified.** The exam state machine, device binding, autosave idempotency, and submission atomicity are all structurally sound and don't need new infrastructure. The `rank_test` per-submission serialization is the one piece that should be fixed (via the in-Postgres debounce approach in §8.1, not new infrastructure) before treating this as production-ready for a real 100-concurrent-submission event. Until Phase 0's load test actually runs, this conclusion remains **structural reasoning, not proof** — the honest answer is "sufficient by design, unverified by measurement."
