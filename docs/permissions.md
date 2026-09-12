# Permissions, Sessions & RLS (canonical)

## Roles

- **student** — default for every signup. Sees only own data + content their active enrollment/grants allow.
- **admin** — full management via admin UI. Promoted only via SQL/service role (never self-service).

Role lives in `profiles.role`; users cannot change their own role (trigger-enforced).

## Session policy — two explicit layers

### Layer 1 — Portal session
One account = **one active authenticated session**. On login:
1. `register_session()` RPC sets `profiles.active_session_id` = the new JWT's `session_id` claim; sets `last_login_at`.
2. Client calls `supabase.auth.signOut({ scope: 'others' })`.

Middleware compares JWT `session_id` vs `active_session_id` (cached ≤30s per user). Mismatch → local signOut → `/login?reason=kicked`.

### Layer 2 — Exam session (strictest, independent)
An `in_progress` attempt is bound to the `device_id` (and `session_id`) that started it. Exam RPCs (`start_attempt` resume / `save_answer` / `submit_attempt`) verify `device_id` and reject any other device with `attempt_locked_other_device`.

### Interaction rule (protects the innocent student)
While a student has an `in_progress` attempt, **a new portal login does NOT evict the exam session**:
- `is_active_session()` returns true for a session that owns a live attempt, even if `active_session_id` has moved on.
- Middleware applies the same exemption.
- The *new* login may browse the portal but is refused entry to the attempt ("exam in progress on another device").
- When the attempt reaches a terminal state, the exemption ends and normal Layer-1 eviction applies.

## DB helpers (security definer, `set search_path = public`)

- `is_admin()` — profiles.role = 'admin' for auth.uid(). Used inside policies (definer avoids RLS recursion).
- `is_active_session()` — JWT session_id = profiles.active_session_id **OR** the session owns an in_progress attempt.
- `has_active_enrollment(p_year_id)` — active enrollment for auth.uid() in that year.
- `can_access_test(p_test_id)` — test published AND (audience year matches active enrollment OR unrevoked access_grant) — the same predicate used by the tests RLS policy.

## RLS matrix (deny-by-default; only listed access exists)

| Table | student | admin |
|---|---|---|
| profiles | SELECT/UPDATE own row (role protected) | ALL |
| years/subjects/books/chapters/topics | SELECT own enrolled year | ALL |
| questions | no direct SELECT (RPC only) | ALL |
| question_versions | no direct SELECT (RPC only); no UPDATE/DELETE for anyone | INSERT/SELECT |
| enrollments | SELECT own | ALL |
| access_grants | SELECT own | ALL |
| test_audiences | SELECT via accessible tests | ALL |
| tests | SELECT where `can_access_test(id)` | ALL |
| test_questions | none (RPC only) | ALL (immutability by trigger) |
| test_attempts | SELECT own; **no INSERT/UPDATE/DELETE** (RPC only) | ALL |
| attempt_answers | SELECT own where attempt not in_progress | SELECT |
| practice_seen / practice_answers | via RPC; SELECT own | SELECT |
| material_folders / materials | SELECT own year (+ folder grants) | ALL |
| audit_logs | none | SELECT (insert via RPCs) |
| import_* | none | ALL |
| question_stats / test_stats | none | SELECT |

Hard guarantees a student must NEVER bypass (tested in pgTAP):
- read another student's profile/attempts/answers/enrollment/results
- read any question's `correct_key`/`explanation` before answering (exam) or answering (practice)
- read an ungranted/unpublished test (direct URL `/tests/123` → 0 rows)
- write questions, tests, grants, or their own `role`
- mutate attempts outside the RPCs

## Enrollment states

`pending` (post-signup, no access) → `active` (admin approved) → `suspended` (temporary, admin) / `expired` (promotion or time) / `revoked` (permanent). Only `active` grants any content access. Access checks always go through the **active** enrollment's year.
