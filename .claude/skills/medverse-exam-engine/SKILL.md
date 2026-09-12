---
name: medverse-exam-engine
description: Use when working on the exam/attempt lifecycle — start/save/submit RPCs, timing, autosave, device binding, or scoring — in MedVerse LMS. Source of truth is docs/exam-state-machine.md and docs/scoring-rules.md; states/transitions/grace values must never be invented.
---

# MedVerse Exam Engine Skill

Canonical sources: [docs/exam-state-machine.md](../../../docs/exam-state-machine.md) (single source of truth for attempt lifecycle) and [docs/scoring-rules.md](../../../docs/scoring-rules.md). **These three states and five transitions are the complete set — do not invent alternative states, transitions, or grace periods.** If a rule seems wrong, change the doc first (with approval), then the code.

## Exact attempt state machine

States: `in_progress` (mutable via `save_answer` only) → `submitted` (immutable) / `invalidated` (immutable, reason required). **There is no separate "expired" state** — an expired attempt becomes `submitted` with `submit_source='auto'`.

Transitions (the complete set — no others exist):
```
(none)      --start_attempt-------------> in_progress
in_progress --submit_attempt-------------> submitted   (submit_source='student')
in_progress --auto_submit_expired--------> submitted   (submit_source='auto')   [cron/lazy finalize]
in_progress --admin invalidate-----------> invalidated (reason + audit log)
submitted   --admin invalidate-----------> invalidated (reason + audit log; enables controlled retake)
```
Terminal states never change state itself (rescoring via `recompute_test` may update the numbers on a `submitted` row, but never its state).

## Server-authoritative timing

- **Official exam expiry = `test_attempts.expires_at`**, computed server-side at start: `least(started_at + duration_minutes, tests.closes_at)`. Server clock only — client timers are display-only (countdown derived from `expires_at - (now + skew)`, skew from `server_now` returned on each RPC).
- Never trust a client-submitted timestamp for expiry, grace, or scoring decisions.

## Academic grace = zero

The exam ends at `expires_at`, full stop. Nothing after it earns marks, as a matter of policy — do not add any leniency window to answer scoring.

## Transport grace rules

- **Transport grace = 30 seconds.** `save_answer` accepts calls until `expires_at + 30s`, but solely to let already-selected answers finish network transit (offline queue flush, slow network, `sendBeacon` on unload). This is delivery tolerance, **not** extra answering time.
- After `expires_at + 30s`, no answer state change is accepted under any circumstance.
- **Finalization sweep = 60 seconds.** `auto_submit_expired()` finalizes attempts past `expires_at + 60s`. This 60s is cron-sweep margin (lets the 30s transport window close first) — never treat it as additional exam time.
- `auto_submit_expired()` is invoked by pg_cron (every minute, primary), Vercel Cron (backup), and lazily on any read of an overdue attempt.

## Device binding

- An `in_progress` attempt is bound to the `device_id` (and `session_id`) that started it (`test_attempts.device_id`, `session_id`).
- `start_attempt`, `save_answer`, and `submit_attempt` all verify `device_id` and reject any other device with `attempt_locked_other_device`.
- `device_id` is a uuid persisted in the client's `localStorage` (`medverse_device_id`). Tabs on the same device coordinate via BroadcastChannel — a second tab shows a blocking overlay rather than racing writes.
- Session-policy interaction (see permissions.md): while a student has a live `in_progress` attempt, a new portal login does **not** evict the exam session — `is_active_session()` returns true for a session that owns a live attempt even after `active_session_id` moves on. The new login can browse the portal but is refused entry to the attempt. The exemption ends once the attempt reaches a terminal state.

## Autosave

- Client: optimistic local state + localStorage cache (key: attempt id); debounced ~1.5s save queue with retry/backoff; flush on `visibilitychange`, `beforeunload` (via `sendBeacon`), and `online`.
- Server: `save_answer(p_attempt_id, p_question_version_id, p_selected_key, p_marked_for_review, p_save_seq, p_device_id)` guards owner, `state='in_progress'`, device match, version belongs to the attempt's test, and the transport-grace window above.

## save_seq

- `attempt_answers` has a unique `(attempt_id, question_version_id)` and a `save_seq bigint` column.
- Upsert is `... ON CONFLICT (attempt_id, question_version_id) DO UPDATE ... WHERE attempt_answers.save_seq < excluded.save_seq` — a strictly-monotonic guard. Duplicate or out-of-order autosave requests are harmless: an older `save_seq` arriving late is silently ignored, never allowed to clobber a newer answer.
- Any new write path touching `attempt_answers` must preserve this monotonic-guard shape — never write it as an unconditional upsert.

## Idempotent submission

- `submit_attempt(p_attempt_id, p_device_id)`: `UPDATE ... SET state='submitted', submitted_at=now(), submit_source='student' WHERE id=$1 AND student_id=auth.uid() AND state='in_progress'`.
  - 1 row updated → call `score_attempt` + `rank_test` in the same transaction; return the result summary.
  - 0 rows **and** state is already `submitted` → return the existing result as an **idempotent success**, not an error. A double-click or duplicate request must produce an identical response, never a second scoring pass or an error toast.
- Client auto-fires `submit_attempt` at 0 on the countdown, but the server enforces expiry regardless of whether the client actually calls it.

## Duplicate-start protection

- `start_attempt(p_test_id, p_device_id)` uses `INSERT ... ON CONFLICT DO NOTHING` against the partial unique index `(test_id, student_id) WHERE state != 'invalidated'`, then selects the row:
  - fresh insert → compute `expires_at`, persist server-shuffled `question_order` (+ option orders if enabled), return payload.
  - existing `in_progress`, same device → **resume**: return `question_order`, saved answers, remaining time.
  - existing `in_progress`, different device → raise `attempt_locked_other_device`.
  - existing `submitted` → raise `already_submitted`.
- This is the mechanism behind "double start" protection in the failure-coverage table — never add a separate app-level "already started" check in front of it; the partial unique index is the source of truth.

## Question-version freezing

- Questions served for an attempt come from frozen `question_version_id`s: `test_questions.question_version_id` is frozen at publish time and immutable after publish (except `voided`/`void_policy`), and `attempt_answers.question_version_id` references those same frozen versions.
- Exam questions are returned to the client **without** `correct_key`/`explanation` (RPC-level omission, not client-side filtering).
- Scoring, resume, and any historical read of an attempt must use the frozen `question_version_id` — never `questions.current_version_id`. Editing a question after publish creates a new version but never rewrites what a published test or a past attempt sees.
- This rule is intentionally also stated in `medverse-database`'s "Immutable question versions" section, from the schema/migration angle rather than the exam-runtime angle. The duplication is deliberate (each skill needs it from its own vantage point) — if the two ever appear to disagree, both must defer to [docs/database.md](../../../docs/database.md), [docs/test-rules.md](../../../docs/test-rules.md), and [docs/scoring-rules.md](../../../docs/scoring-rules.md), never to each other.

## Scoring requirements

- Computed over the attempt's `question_order` (frozen versions):
  ```
  correct  = answers where selected_key = version.correct_key
  wrong    = answers where selected_key is not null and != correct_key
  blank    = questions with no answer or selected_key null
  score    = correct * marks_per_question(or per-question override) - wrong * negative_mark
  percentage = 100 * score / max_score        (max_score = sum of marks of non-excluded questions)
  ```
- `negative_mark` applies **per wrong answer**; blank answers are never penalized.
- Score may be negative; percentage is **not clamped** — store the exact computed value (display may floor at 0, stored value must not).
- Rounding: store `numeric` exact to 2 decimal places (`round(x, 2)`) for both score and percentage.
- Voided questions: `void_policy = 'exclude'` removes the question from `max_score` and ignores its answers entirely; `void_policy = 'credit_all'` gives every attempt full marks for it while it stays in `max_score`. `recompute_test(test_id)` rescores every submitted attempt under current void flags and re-ranks; historical answer rows are untouched.
- Ranking: `rank = RANK() OVER (ORDER BY score DESC, submitted_at ASC)` (earlier submit wins ties); `percentile = round(100.0 * (n - rank) / greatest(n - 1, 1), 2)` where `n` = submitted attempts. Only `submitted` attempts rank; `invalidated` are excluded. Re-run `rank_test(test_id)` on every submit.
- `score_attempt` must be a **pure function** of stored rows (answers + frozen versions + test config + void flags) — rescoring the same data must always reproduce identical results.
- Practice mode is never scored/ranked: `submit_practice_answer` records `is_correct` and returns `correct_key` + `explanation` + `reference` immediately; practice stats feed analytics only.

## Recovery requirements

The full failure-coverage table (all must hold — this is the acceptance bar for any exam-engine change):

| Scenario | Mechanism |
|---|---|
| Refresh / back button | resume path: persisted order + saved answers + server time |
| Multiple tabs (same device) | BroadcastChannel block; `save_seq` keeps writes consistent regardless |
| Multiple devices | `device_id` check → `attempt_locked_other_device` |
| Internet loss / crash | server-side autosave (≤1.5s debounce) + local queue flush on reconnect |
| Expired timer | server `expires_at` guard + cron + lazy finalize |
| Submission at closing time | server clock + transport grace |
| Double-click submit / duplicate requests | idempotent submit; `save_seq` monotonic upsert |
| Clock tampering | server timestamps only |
| Double start | partial unique index |
| New portal login mid-exam | exam-session exemption (permissions.md) |

Any change to the exam engine must be checked against every row of this table, not just the scenario it was written for.

## No excluded technology

[docs/architecture.md](../../../docs/architecture.md) fixes the stack and explicitly excludes, at current scale: Redis, WebSockets-everywhere, microservices, a separate Node backend, ElasticSearch, event-driven architecture. AGENTS.md restates this: "No new tech (Redis, websockets, separate backend, etc.)."

This applies directly to exam-engine work, because the exam path is exactly where it's tempting to reach for that kind of infrastructure (live timer sync, cross-tab/cross-device coordination, push notifications on lock/eviction). **Do not introduce any of it** — not even "just for this one feature." Use only the mechanisms already documented above and in the canonical docs:

- **BroadcastChannel** for same-device, cross-tab coordination (the existing second-tab blocking overlay).
- **`localStorage`** for `device_id` persistence and the client-side answer/attempt cache.
- **Polling / cron** (`pg_cron` primary, Vercel Cron backup, lazy finalize on read) for expiry sweeps — not a push/websocket mechanism.
- **PostgreSQL RPCs** (`SECURITY DEFINER`) for every state-changing exam operation — not a separate service or queue.
- **The existing Next.js + Supabase architecture** (server actions, Supabase client/server/admin libs) for everything else.

If a real gap surfaces that seems to need one of the excluded technologies, that is a documentation/architecture decision for the project owner — raise it against `docs/architecture.md` first (with approval) rather than adding the technology directly.
