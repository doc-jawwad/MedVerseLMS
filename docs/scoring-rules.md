# Scoring & Timing Rules (canonical)

## Timing policy

- **Official exam expiry = `test_attempts.expires_at`** — computed in Postgres at start: `least(started_at + duration_minutes, tests.closes_at)`. Server clock only.
- **Academic grace = ZERO.** The exam ends at `expires_at`. Nothing after it earns marks as a matter of policy.
- **Transport grace = 30 seconds.** `save_answer` accepts calls until `expires_at + interval '30 seconds'` solely to let already-selected answers finish network transit (offline queue flush, slow network, sendBeacon on unload). This is delivery tolerance, not extra answering time. After `expires_at + 30s`, no answer state change is accepted under any circumstance.
- **Finalization sweep = 60 seconds.** `auto_submit_expired()` finalizes attempts past `expires_at + 60s`. The 60s is cron-sweep margin (lets the transport window close first), never extra time.

## Marking

For a submitted attempt, over the attempt's `question_order` (frozen question_versions):

```
correct  = answers where selected_key = version.correct_key
wrong    = answers where selected_key is not null and ≠ correct_key
blank    = questions with no answer or selected_key null
score    = correct × marks_per_question(or per-question override) − wrong × negative_mark
percentage = 100 × score / max_score        (max_score = Σ marks of non-excluded questions)
```

- `negative_mark` applies **per wrong answer** (e.g. 0.25). Blank answers are never penalized.
- Score may be negative; percentage floors at the raw computed value (no clamping) — display may show 0 floor but stored value is exact.
- Rounding: store `numeric` exact to 2 decimal places (`round(x, 2)`); percentages to 2 dp.

## Voided questions (`test_questions.voided`)

Per-question `void_policy` chosen by admin at void time, recorded in audit log:
- `exclude` — question removed from max_score; answers to it ignored entirely.
- `credit_all` — every attempt receives full marks for it regardless of answer; it stays in max_score.

`recompute_test(test_id)` rescores every submitted attempt with current void flags, then re-ranks **once**. Historical answer rows are untouched.

## Ranking

### What (product semantics — unchanged)

```
rank       = RANK() OVER (ORDER BY score DESC, submitted_at ASC)   -- earlier submit wins ties
percentile = round(100.0 × (n − rank) / (n − 1), 2)                -- n = submitted attempts, n > 1
```
Only `submitted` attempts rank; `invalidated` are excluded. Columns `test_attempts.rank` / `percentile` remain the only source anyone reads. Students who were **not eligible** during the window, and students who were eligible but never started, are **not** ranked and must **not** be stored as zero. Ranking population vs leaderboard **view** authorization: [access-eligibility-analytics.md](access-eligibility-analytics.md).

**n ≤ 1 (unranked):** with only one submitted attempt there is no comparison group, so a percentile is not meaningful — neither 0 nor 100 describes anything real. `percentile` is `null` in this case (displayed as "—"), while `rank` is still `1`. This is an explicit exception to the formula above, not a value it happens to produce.

### When (coalesced ranking)

`rank_test(test_id)` must **not** run inside every `score_attempt` / `submit_attempt` on the live path. A burst of near-simultaneous submits each rewriting every submitted row is O(n²) work plus row-lock convoys. That cost is **independent of Vercel vs VPS**. Planning target (~1,500 concurrent participants) makes this a production requirement; it is **not** a measured 1,500-user proof — load-test before/after on the Data API path ([deployment.md](deployment.md)).

Required design (same pattern `recompute_test` already uses: score many, rank once):

1. `score_attempt` writes score fields only (pure function of stored rows — see Determinism) and marks the test dirty by inserting a `rank_dirty_queue` row. It must **not** `UPDATE tests` for that signal — concurrent same-test submits must not serialize on the tests row. (`tests.rank_dirty_at` remains a leftover drain source for older writers.)
2. `rank_dirty_tests()` calls `rank_test` **at most once per distinct dirty test** and clears queue rows (and any leftover `rank_dirty_at`) **before** ranking so a concurrent submit during `rank_test` is picked up on the next tick. `test_attempts.rank` / `percentile` remain the only values anyone reads.
3. Scheduling reuses the **already-documented** `medverse-auto-submit` pg_cron job (`* * * * *`). `auto_submit_expired()` scores any expired attempts, then always calls `rank_dirty_tests()` — including when zero attempts expired — so isolated student submits wait at most one existing auto-submit window. The HTTP backup cron (`GET /api/cron/auto-submit`) hits the same function. This is not a new debounce interval.
4. `auto_submit_expired` therefore ranks each affected test **once** per tick, not once per attempt. `recompute_test` still ranks once at the end (admin void path) and clears the dirty marker.

Isolated submits may see rank/percentile lag for up to one minute; score on the result payload stays immediate and correct.

Do **not** introduce Redis, queues, or Workers to rank. Do **not** change RANK/percentile/tie-break formulas when relocating the call.

## Determinism

`score_attempt` is a pure function of stored rows (answers + frozen versions + test config + void flags). Rescoring must always reproduce identical results from the same data. Never score against `questions.current_version_id` — only against `test_questions.question_version_id` / `attempt_answers.question_version_id`.

## Practice mode

Not scored/ranked. `submit_practice_answer` records `is_correct` and returns correct_key + explanation + reference immediately. Practice stats feed analytics only.
