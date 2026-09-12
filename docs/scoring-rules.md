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

`recompute_test(test_id)` rescores every submitted attempt with current void flags, then re-ranks. Historical answer rows are untouched.

## Ranking

After each scoring (and after recompute):
```
rank       = RANK() OVER (ORDER BY score DESC, submitted_at ASC)   -- earlier submit wins ties
percentile = round(100.0 × (n − rank) / greatest(n − 1, 1), 2)     -- n = submitted attempts
```
Only `submitted` attempts rank; `invalidated` are excluded. Re-run `rank_test(test_id)` on every submit (cheap at class scale).

## Determinism

`score_attempt` is a pure function of stored rows (answers + frozen versions + test config + void flags). Rescoring must always reproduce identical results from the same data. Never score against `questions.current_version_id` — only against `test_questions.question_version_id` / `attempt_answers.question_version_id`.

## Practice mode

Not scored/ranked. `submit_practice_answer` records `is_correct` and returns correct_key + explanation + reference immediately. Practice stats feed analytics only.
