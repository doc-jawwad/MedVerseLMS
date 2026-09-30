# Schema-lane integration contract

**Status:** SHIPPED for objects listed below (migrations `20260919250000`–`20260919252000`). Source of product law: SPEC FREEZE in [architecture.md](architecture.md), [database.md](database.md), [permissions.md](permissions.md), [access-eligibility-analytics.md](access-eligibility-analytics.md), [test-rules.md](test-rules.md).

**Ownership:** Only the **schema lane** may create or modify `supabase/migrations/*.sql`, RLS, or SECURITY DEFINER RPCs for these objects.

**Feature lanes must not:** invent tables, columns, RPCs, or local mocks that contradict this contract. Consume the interfaces below via server actions / supabase-js.

**Theme lane:** Light / Dark / System is **client-only** (no DB).

**Flashcards:** placeholder category only — **no** flashcard table or engine. `material_folders.library_type` may be `'flashcards'` for empty placeholder folders.

**Subjects → Blocks remap:** **SHIPPED** (migration `20260920073248`). `subjects.product_key` is the authoritative Block / Final Year clinical key. Departmental subjects keep `product_key` NULL for QB taxonomy. `get_academic_tree` returns only `product_key IS NOT NULL` subjects with canonical names.

**Prof. Session days:** **SHIPPED** — `prof_session_days` + `prof_session_day_slots` (fixed chrome). Free students get `prof_session.locked=true` and empty `days`. Subscribed students see Admin-created published days only (no structural Day 1–3 fallback in RPC).

**Content bin:** **SHIPPED** — soft-delete (`deleted_at` / `purge_after` / `deleted_by`) on materials, folders, pearls, OSPE stations, questions, prof session days; polymorphic `soft_delete_content` / `restore_content` / `list_content_bin` / `purge_content`; `purge_expired_bin_items` + `r2_purge_queue` (R2 bytes deleted by claim/complete worker after DB purge).

---

## Class / Block identifiers

| `year_number` | Display name | Identifier |
|---|---|---|
| 1–4 | 1st–4th Year MBBS | `years.id` |
| 5 | Final Year MBBS | `years.id` |

Second level = `subjects.id` (product Blocks after future mapping).

---

## SHIPPED objects

### Tables
- `admin_year_assignments` `(admin_id, year_id)` unique
- `practice_progress` `(student_id, item_kind, item_id)` unique; `item_kind` question|pearl|ospe; `state` remaining|done; `marked`
- `practice_sessions` (optional report summary)

### Additive columns
- `profiles.college_name`, `profiles.avatar_object_key` (`study-content/avatars/…`)
- `subscriptions.year_id` not null (backfilled)
- `subscription_applications.year_id` not null (backfilled)
- `material_folders.parent_id` (cycle-guarded)
- `material_folders.library_type` adds `past_papers`, `flashcards`

### RPCs
- `get_class_lock_state()`, `self_change_class(p_year_id)`
- `list_admin_year_assignments`, `set_admin_year_assignments`, `admin_can_access_year`
- `get_practice_progress`, `set_practice_item_state`, `set_practice_item_marked`, `reset_practice_done_to_remaining`
- `start_practice_session`, `end_practice_session`
- `get_academic_tree(p_surface)`, `search_academic_tree(p_query, p_limit)`
- `test_leaderboard_projection(p_test_id, p_limit)` — wraps `rank_test` ranks; fields: rank, student_id, full_name, college_name, avatar_object_key, score
- `update_own_profile`, `allocate_avatar_object_key`, `authorize_avatar_object`

### Updated behavior
- `create_year_change_request` rejected when lock=`free` (`use_self_change_class`)
- `approve_year_change_request` / `promote_student` sync live `subscriptions.year_id` and remap `subscriptions.plan_id` to an active destination-year plan (fail `destination_plan_unavailable` before enrollment mutation if none)
- `create_subscription_application` / `update_pending_*` accept `p_year_id` and require an explicit class-scoped `p_plan_id` (no single-global-plan auto-resolve; enrollment + year match enforced)
- `activate_subscription` / `approve_subscription_application` set/sync purchase class + enrollment
- BEFORE INSERT triggers default `subscriptions.year_id` / `subscription_applications.year_id` from active enrollment when omitted (compat for older insert paths)
- `self_change_class` does **not** call admin-only `log_audit` (student self-serve path)

---

## Explicit non-goals (this ship)

- No `classes` / `blocks` / `flashcards` tables
- No subject department → Block destructive remap
- No changes to `test_attempts` lifecycle, `rank_test` formula, or exam grace
- No staging/production apply from this lane alone
- Leaderboard projection returns only rows with non-null `rank` (after `rank_dirty_tests` / cron coalescing)
