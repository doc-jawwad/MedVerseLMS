# Exam Attempt State Machine (single source of truth)

**Implementers must not invent alternative states or transitions.** These three states and five transitions are the complete set.

## States

| State | Meaning | Mutable? |
|---|---|---|
| `in_progress` | Student is taking the test | answers via `save_answer` only |
| `submitted` | Finalized and scored (by student, auto, or admin close) | immutable |
| `invalidated` | Admin voided the attempt (reason required) | immutable |

There is no separate "expired" state: an expired attempt becomes `submitted` with `submit_source='auto'`.

## Transitions

```
(none) ──start_attempt──────────────▶ in_progress
in_progress ──submit_attempt────────▶ submitted   (submit_source='student')
in_progress ──auto_submit_expired───▶ submitted   (submit_source='auto')   [cron/lazy finalize]
in_progress ──admin invalidate──────▶ invalidated (reason + audit log)
submitted   ──admin invalidate──────▶ invalidated (reason + audit log; enables controlled retake)
```

No other transition exists. Terminal states never change (except rescoring numbers on `submitted` via `recompute_test` — state itself never changes).

## RPC contracts (all SECURITY DEFINER; ownership + state + device checked)

### `start_attempt(p_test_id uuid, p_device_id uuid)`
1. Requires: student role, `is_active_session()`, active enrollment, `can_access_test`, `now()` within [opens_at, closes_at), test status `published`.
2. `INSERT ... ON CONFLICT DO NOTHING` (partial unique (test_id, student_id) WHERE state != 'invalidated'), then SELECT the row:
   - fresh insert → compute `expires_at = least(now() + duration, closes_at)`; persist server-shuffled `question_order` (+ option orders if enabled); return payload.
   - existing `in_progress`, same device → **resume**: return question_order, saved answers, remaining time.
   - existing `in_progress`, different device → raise `attempt_locked_other_device`.
   - existing `submitted` → raise `already_submitted`.
3. Returns: `started_at`, `expires_at`, `server_now`, questions (via frozen versions, **without** correct_key/explanation), saved answers.

### `save_answer(p_attempt_id, p_question_version_id, p_selected_key, p_marked_for_review, p_save_seq, p_device_id)`
Guards: owner, `state='in_progress'`, device matches, version belongs to attempt's test, transport-grace window (see scoring-rules.md).
Upsert on (attempt_id, question_version_id) with `WHERE attempt_answers.save_seq < excluded.save_seq` — duplicates/out-of-order harmless.
Returns `{saved, server_now, expires_at}` (heartbeat + clock resync).

### `submit_attempt(p_attempt_id, p_device_id)`
`UPDATE ... SET state='submitted', submitted_at=now(), submit_source='student' WHERE id=$1 AND student_id=auth.uid() AND state='in_progress'`.
- 1 row → call `score_attempt` + `rank_test` in same transaction; return result summary.
- 0 rows and state already `submitted` → **return the existing result (idempotent success), not an error.** Double-click / duplicate request = identical response.

### `auto_submit_expired()`
Finalizes all `in_progress` past `expires_at + 60s` (submit_source='auto'), scores each. Invoked by pg_cron (every minute), Vercel Cron backup, and lazily on any read of an overdue attempt.

### Admin: `invalidate_attempt(p_attempt_id, p_reason text)`
Reason mandatory. Sets state='invalidated', invalidated_reason, invalidated_by; audit-logged. Never deletes rows or answers. The partial unique index then permits one fresh attempt.

## Client protocol (UX layer — server rules above are authoritative regardless)

- Countdown from `expires_at - (now + skew)`; skew from `server_now` at each RPC response.
- Optimistic local state + localStorage cache (key: attempt id); debounced ~1.5s save queue, retry with backoff; flush on `visibilitychange`, `beforeunload` (sendBeacon), and `online`.
- Client auto-fires `submit_attempt` at 0 (server enforces anyway).
- `device_id`: uuid in localStorage (`medverse_device_id`). Tabs on same device coordinate via BroadcastChannel — second tab shows a blocking overlay.
- Mobile-friendly layout; palette shows answered / unanswered / marked-for-review.

## Failure coverage (must all hold)

| Scenario | Mechanism |
|---|---|
| Refresh / back button | resume path: persisted order + saved answers + server time |
| Multiple tabs (same device) | BroadcastChannel block; save_seq keeps writes consistent regardless |
| Multiple devices | device_id check → `attempt_locked_other_device` |
| Internet loss / crash | server-side autosave (≤1.5s debounce) + local queue flush on reconnect |
| Expired timer | server expires_at guard + cron + lazy finalize |
| Submission at closing time | server clock + transport grace (scoring-rules.md) |
| Double-click submit / duplicate requests | idempotent submit; save_seq monotonic upsert |
| Clock tampering | server timestamps only |
| Double start | partial unique index |
| New portal login mid-exam | exam-session exemption (permissions.md) |
