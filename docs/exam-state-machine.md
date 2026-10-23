# Exam Attempt State Machine (single source of truth)

**Implementers must not invent alternative states or transitions.** These three states and the transitions listed below are the complete set.

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
in_progress ──admin disposition finalize──▶ submitted (submit_source='admin')  [account-status change only; see below]
in_progress ──admin invalidate──────▶ invalidated (reason + audit log)
submitted   ──admin invalidate──────▶ invalidated (reason + audit log; enables controlled retake)
```

A **reattempt** is not a transition: it is a new row entering via `start_attempt` (`(none) → in_progress`) when the test’s `max_attempts` allows ([test-rules.md](test-rules.md)). Earlier attempts keep their terminal state.

No other transition exists. Terminal states never change (except rescoring numbers on `submitted` via `recompute_test` — state itself never changes). Ranking **timing** may lag a coalesced job ([scoring-rules.md](scoring-rules.md)); that is not a new attempt state.

## RPC contracts (all SECURITY DEFINER; ownership + state + device checked)

Auth identity is `auth.uid()` / `auth.jwt()` from the PostgREST-verified Cloud access token ([architecture.md](architecture.md), [permissions.md](permissions.md)). Device binding and save_seq are unchanged on VPS.

### `start_attempt(p_test_id uuid, p_device_id uuid, p_attempt_no int default null)`
1. Always requires: student role, `is_active_session()`, live **class** enrollment on a **new** start. **New start** (first attempt or reattempt) also requires `account_status = 'active'`, **`can_access_test`** (content entitlement — not catalog-only `can_view_test`), `now()` within `[opens_at, closes_at)`, test status `published`.
2. **Resume** of an existing `in_progress` attempt skips `can_access_test`, published, and the live window (resume-while-closed after `close_test_now`; resume after paid expiry). Then run `finalize_if_expired`. Resume is **same-device only**. There is no separate interrupted state.
3. **Attempt selection** (attempt limit: [test-rules.md](test-rules.md) “Attempt limit and reattempts”). `c` = counted attempts (`in_progress` + `submitted`; invalidated never count), read **after** taking the existing new-start `tests … FOR UPDATE` lock so concurrent new starts for the same test serialize and `c` cannot go stale before the INSERT. `p_attempt_no` is the counted-attempt number the caller intends to start (explicit retake intent). Existing callers send `null`.
   - **Existing `in_progress`** (any `max_attempts`, any `p_attempt_no`):
     - same device → **resume**: return question_order, saved answers, remaining time (from stored, possibly **clamped**, `expires_at`).
     - different device → raise `attempt_locked_other_device`.
     - same-call lazy `finalize_if_expired` that converts `in_progress` → `submitted` → **return** `{ already_submitted: true, attempt_id, … }` so the submit commits. Raising here would roll the auto-submit back and `/result` would 404.
   - **`max_attempts = 1` (single-attempt; today’s contract, `p_attempt_no` ignored):** `c = 0` → new start; `c ≥ 1` → raise `already_submitted`.
   - **`max_attempts > 1`, no `in_progress`** — evaluated in this order; every branch except "new start" creates no row:
     1. `c = 0` and `p_attempt_no` is `null` or `1` → **new start**.
     2. `c ≥ 1` and `p_attempt_no` is `null` → raise `already_submitted` (legacy caller, reload of the exam page after submit, lazy-finalize redirect path). A `null` call never starts a reattempt.
     3. `c ≥ max_attempts` → raise `attempt_limit_reached` (attempts exhausted).
     4. `p_attempt_no = c + 1` → **new start** (reattempt).
     5. otherwise (`p_attempt_no ≤ c` duplicate/stale retry after that attempt already exists, or `> c + 1` after an invalidation changed the count) → raise `attempt_no_mismatch`; the client reloads list state.
   - **New start**: run every new-start guard in step 1, then `INSERT ... ON CONFLICT DO NOTHING` on the partial unique `(test_id, student_id) WHERE state = 'in_progress'` and SELECT the row. Fresh insert → compute `expires_at = least(now() + duration, closes_at)` (**late-start effective deadline** — a late sit cannot outrun `closes_at`); persist server-shuffled `question_order` (+ option orders if enabled); return payload.
4. Returns: `attempt_id`, attempt number, `max_attempts`, `started_at`, `expires_at`, `server_now`, questions (via frozen versions, **without** correct_key/explanation), saved answers.

**8J-D:** the live countdown accepts an **earlier** server `expires_at` (close-now clamp) from `start_attempt` / `save_answer` responses and must never extend a deadline from stale local state. Full reload remounts from the resume payload. Server save/submit still enforce `test_attempts.expires_at`.

### `save_answer(p_attempt_id, p_question_version_id, p_selected_key, p_marked_for_review, p_save_seq, p_device_id)`
Guards: owner, `state='in_progress'`, device matches, version belongs to attempt's test, transport-grace window (see scoring-rules.md).
Upsert on (attempt_id, question_version_id) with `WHERE attempt_answers.save_seq < excluded.save_seq` — **latest MCQ selection wins**; a lower `save_seq` never overwrites a higher one. Duplicates/out-of-order are harmless.
Returns `{saved, server_now, expires_at}` (heartbeat + clock resync).

### `submit_attempt(p_attempt_id, p_device_id)`
`UPDATE ... SET state='submitted', submitted_at=now(), submit_source='student' WHERE id=$1 AND student_id=auth.uid() AND state='in_progress'`.
- 1 row → call `score_attempt` in the same transaction (score fields only); **do not** call `rank_test` inline — mark the test dirty for coalesced ranking ([scoring-rules.md](scoring-rules.md)). Return the result summary (score immediate; rank/percentile may still be previous/null until the rank job runs).
- 0 rows and state already `submitted` → **return the existing result (idempotent success), not an error.** Double-click / duplicate request = identical response.

### `auto_submit_expired()`
Finalizes all `in_progress` past `expires_at + 60s` (submit_source='auto'), scores each, then `rank_test` **once per dirty test** via `rank_dirty_tests()` (not once per attempt). Invoked by pg_cron (every minute, primary; the same tick also drains ranks from ordinary submits), a VPS systemd timer hitting `GET /api/cron/auto-submit` (backup; same `CRON_SECRET` + service-role RPC), and lazily on any read of an overdue attempt (`finalize_if_expired` scores one attempt and marks dirty; ranking waits for the minute tick).

Unanswered questions are **blank → zero contribution** ([scoring-rules.md](scoring-rules.md)). Auto-submit of a blank or partial paper is a real `submitted` score, not an ineligible zero ([access-eligibility-analytics.md](access-eligibility-analytics.md) §8). Academic grace remains **zero**; transport grace remains **30s**; the sweep remains **60s**. Close-now reuses these clocks on the clamped `expires_at` — it does not invent a new grace.

### Admin: `invalidate_attempt(p_attempt_id, p_reason text)`
Reason mandatory. Sets state='invalidated', invalidated_reason, invalidated_by; audit-logged. Never deletes rows or answers. The invalidated attempt stops counting toward `max_attempts`, so one fresh attempt becomes available while the test is open. Invalidating a `submitted` attempt marks the test rank-dirty (the student’s ranked attempt may change — [test-rules.md](test-rules.md)).

## Client protocol (UX layer — server rules above are authoritative regardless)

- Countdown from `expires_at - (now + skew)`; skew from `server_now` at each RPC response.
- Optimistic local state + durable localStorage draft (`medverse_attempt:{attemptId}`) holding only `{question_version_id, selected_key, marked_for_review, seq}` — never stems/options/keys/explanations. On resume, merge with server answers by **higher `save_seq` wins** (equal prefers server); local-ahead rows are re-queued. Draft entries clear on server ACK / submit / terminal finalize. Debounced ~1.5s save queue, retry with backoff; flush on `visibilitychange`, `beforeunload`, and `online`. Concurrent dispatch of pending `save_answer` calls is an allowed client optimization; the server still accepts one question per RPC.
- Client auto-fires `submit_attempt` at 0 (server enforces anyway).
- `device_id`: uuid in localStorage (`medverse_device_id`). Tabs on same device coordinate via BroadcastChannel — second tab shows a blocking overlay.
- Mobile-friendly layout; palette shows **answered** (`selected_key` set), **skipped** (`marked_for_review` and `selected_key` null), and **remaining** (neither). Skip is unanswered-only client UX persisted through existing `save_answer(p_marked_for_review)`; it is not a new attempt state and does not score. Selecting an option clears skip. Scoring still treats null `selected_key` as blank.
- Exam RPCs remain `supabase.rpc(...)` from the browser against the unified origin (`/rest/v1`). Do not move save/submit into a custom Next.js REST layer.

## Failure coverage (must all hold)

| Scenario | Mechanism |
|---|---|
| Refresh / back button / crash / tab close | resume path: persisted order + saved answers + server time; same device; no extra interrupted state |
| Multiple tabs (same device) | BroadcastChannel block; save_seq keeps writes consistent regardless |
| Multiple devices | device_id check → `attempt_locked_other_device` |
| Internet loss / crash | durable local draft + server autosave (≤1.5s debounce); same-device resume merges by save_seq then flushes local-ahead |
| Expired timer | server expires_at guard + cron + lazy finalize |
| Submission at closing time | server clock + transport grace (scoring-rules.md) |
| Double-click submit / duplicate requests | idempotent submit; save_seq monotonic upsert |
| Clock tampering | server timestamps only |
| Double start / retake double-click / stale retry | partial unique `in_progress` index (second concurrent call resumes the first’s row) + `p_attempt_no` check (`attempt_no_mismatch`) + counted-attempts check under the new-start `tests` lock |
| Reattempt after submit | new row; earlier attempts untouched; `max_attempts` + window + entitlement enforced in `start_attempt` |
| New portal login mid-exam | exam-session exemption (permissions.md) |
| Admin sets account to restricted/suspended/deactivated/revoked mid-exam | **explicit disposition required** (section below) — do not invent a new attempt state |

## Account-status change during an in-progress attempt

Attempt states and transitions above are unchanged. When an authorized admin sets `profiles.account_status` to `restricted`, `suspended`, `deactivated`, or `revoked` and the student currently has an `in_progress` attempt, the admin RPC **must take an explicit attempt disposition**. Portal LMS access is blocked in all cases (Layer 1 kick). Do not silently pick a disposition in application code.

Allowed dispositions (all must be implemented; the operator chooses one per action). None of these add attempt states:

| Disposition | Effect on the attempt | Exam RPCs |
|---|---|---|
| `leave_in_progress` | State stays `in_progress`. Layer 2 device/session binding unchanged. Portal remains blocked. Attempt ends only via existing submit / auto-submit / invalidate transitions. | `save_answer` / `submit_attempt` / resume continue for that device+session until terminal |
| `invalidate` | Existing `invalidate_attempt` (reason required, audit-logged) | No further saves |
| `finalize` | Finalize using **existing** submit machinery (`submit_source='admin'` already exists on the column; do not add a new state). Score via the existing `score_attempt` path; ranking remains coalesced. | Terminal `submitted` |

Exact RPC parameter names are an implementation detail; the three behaviors are not.

`is_active_session()` / exam RPCs must honor `leave_in_progress` (Layer 2 lives) even though `account_allows_lms()` is false. The other two dispositions do not need an exam exemption.

