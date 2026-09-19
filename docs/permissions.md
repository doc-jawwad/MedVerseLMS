# Permissions, Sessions & RLS (canonical)

Four independent concepts. Do not collapse them:

| Concept | Where it lives | What it controls |
|---|---|---|
| **Account status** | `profiles.account_status` | Whether the person may sign in and enter the LMS at all |
| **Class enrollment** | `enrollments` | Assigned MBBS year (one live class). Not payment. Not LMS approval. |
| **Subscription** | `subscriptions` (+ applications) | Paid/complimentary time-bounded plan. Not the class year. |
| **Resource entitlement** | resource policy + grants + restrictions | Whether a visible catalog item can be **used** (start test, open file, practice) |

Email verification does **not** require admin approval. After verification, an **active** student enters the LMS immediately. Free resources are usable without a paid subscription. Paid resources stay **visible but locked** until entitled.

Do **not** infer historical test eligibility or academic history from current subscription. Lifetime analytics, missed vs not-eligible, and leaderboard population: [access-eligibility-analytics.md](access-eligibility-analytics.md).

`/pending` is kept as a route for backward compatibility. It is **not** the registration-approval gate. It may send blocked accounts (`restricted` / `suspended` / `deactivated` / `revoked`) to a clear blocked notice.

## Roles

- **student** — default for every signup. May enter the LMS only when `account_status = 'active'`. Sees catalog for their assigned class; uses a resource only if entitled.
- **admin** — `profiles.role = 'admin'`. May enter `/admin`. **Does not** imply every mutation. Authorization is **permission-based** (below). Promoted only via Main Admin (or the one-time first-Main-Admin bootstrap); never self-service.

Role lives in `profiles.role`; users cannot change their own role (trigger-enforced). Students cannot change `account_status`, `is_main_admin`, or permission rows.

### Main Admin vs other admins

- **Main Admin** (`profiles.is_main_admin`): all permissions. The first migration sets every existing `role = 'admin'` row to Main Admin.
- **First Main Admin bootstrap:** `bootstrap_first_main_admin()` promotes the **caller** to Main Admin only when **no** `is_main_admin` row exists. Used by `scripts/create-dev-account.mjs --admin` on VPS staging/local where opaque `sb_secret_*` is not a PostgREST JWT. Additional admins still go through `set_admin_role` (Main Admin / `manage_admins`). The RPC does not accept `sb_secret_*` as a Bearer and does not grant PostgREST `service_role`.
- Other admins receive **granular** `admin_permissions` rows. They do not inherit full privilege.
- Presets (Main Admin, Academic/MCQ, Operations, Custom) are **UI convenience only**. The database authorizes `has_permission(code)`, not the preset name.
- The **last** Main Admin cannot be removed or demoted.
- The **last active** Main Admin cannot be blocked (`restricted` / `suspended` / `deactivated` / `revoked`). That would lock the academy out of Main Admin recovery. Other admins may be disabled with `set_account_status`; targeting `role = 'admin'` also requires `manage_admins`.

## Account status

`profiles.account_status text check in ('active','restricted','suspended','deactivated','revoked')`, default `'active'` at `ensure_profile()`.

| Status | Sign in / enter LMS | Notes |
|---|---|---|
| `active` | Yes | Default after email verification |
| `restricted` | **No** | Fully blocked until an authorized admin restores. Distinct from **resource-level** deny. |
| `suspended` | **No** | Temporary hold |
| `deactivated` | **No** | Longer-term offboarding |
| `revoked` | **No** | Permanent bar; **Main Admin may restore** to `active` |

**Restricted (account) vs restricted (resource):** account `restricted` blocks the entire LMS (clear blocked notice, e.g. `/pending`). A **resource restriction** (`access_restrictions`) applies to an otherwise **active** student and denies that item only.

Restore is the transition back to `active` (from restricted, suspended, deactivated, or revoked). It is not a stored status.

**Kick** remains Layer 1 (replace/clear `active_session_id`, Auth `signOut` others). Blocking transitions must also kick the portal session.

`is_active_session()` for **portal** use requires `account_status = 'active'` (plus the JWT/`active_session_id` match). Exam continuation after a blocking status change is **not** implicit — see [exam-state-machine.md](exam-state-machine.md) “Account-status change during an in-progress attempt”.

## Identity on VPS vs Cloud Auth

Production Auth is **Supabase Cloud**; application rows are **VPS PostgreSQL** ([architecture.md](architecture.md)).

- `profiles.id` is the Auth user UUID (`JWT sub`). On the VPS it is **not** a foreign key to `auth.users` (that table is not on the VPS).
- RLS and SECURITY DEFINER helpers keep using `(select auth.uid())` and `auth.jwt() ->> 'session_id'`. Those read PostgREST JWT GUCs after PostgREST verifies the Cloud-issued access token. They do not query Cloud `auth.users`.
- Idempotent `ensure_profile()` creates `profiles` (`account_status` default `active`) and an **active** class enrollment from JWT `user_metadata.year_id` when that year exists and the student has no live `active` enrollment. Call it after signup (when a session exists) / verify / signIn, before `register_session()`. It never writes `role`, `account_status` (on update), or `is_main_admin`. `handle_new_user()` on `auth.users` remains in migrations for managed-Supabase portability; it will not fire across the Auth/DB split.
- Deleting a user in Cloud Auth does **not** cascade to VPS `profiles` / attempts. Exact user-delete semantics are **pending approval** ([deployment.md](deployment.md)).

## Session policy — two explicit layers

### Layer 1 — Portal session
One account = **one active authenticated session**. On login:
1. `register_session()` RPC sets `profiles.active_session_id` = the new JWT's `session_id` claim; sets `last_login_at`.
2. Client calls `supabase.auth.signOut({ scope: 'others' })`.

`src/proxy.ts` refreshes the Auth cookie and does optimistic redirects only. **Authoritative** Layer-1 check is `requireUser()` (and exam RPCs via `is_active_session()`): JWT `session_id` vs `profiles.active_session_id`. Mismatch without the exam exemption → local signOut → `/login?reason=kicked`. This is per request (`cache()` within one Server Component render), not a timed cache.

A non-`active` account status must not enter student or admin shells. UX may use `/pending` as the blocked-account destination (compatibility). That is not enrollment approval.

### Layer 1 companion — session watch (polling)

VPS production **does not run Supabase Realtime**. The client companion to Layer 1 (`SessionWatch`) **MUST** poll (for example `current_session_id` / `owns_live_attempt_session` / `profiles.active_session_id`), not `postgres_changes`. Polling interval is a UX choice; it must not be treated as the security boundary — RPCs still enforce `is_active_session()`.

`SessionWatch` polls `current_session_id` plus own `profiles.active_session_id` (15s, plus on tab visible). It must not subscribe to `postgres_changes`. Polling is not the security boundary — RPCs still enforce `is_active_session()`.

### Layer 2 — Exam session (strictest, independent)
An `in_progress` attempt is bound to the `device_id` (and `session_id`) that started it. Exam RPCs (`start_attempt` resume / `save_answer` / `submit_attempt`) verify `device_id` and reject any other device with `attempt_locked_other_device`.

### Interaction rule (protects the innocent student)
While a student has an `in_progress` attempt, **a new portal login does NOT evict the exam session**:
- `is_active_session()` returns true for a session that owns a live attempt, even if `active_session_id` has moved on.
- `requireUser()` / `proxy.ts` apply the same exemption (live-attempt RPC).
- The *new* login may browse the portal but is refused entry to the attempt ("exam in progress on another device").
- When the attempt reaches a terminal state, the exemption ends and normal Layer-1 eviction applies.

This login-kick exemption is **unchanged**. It is not the same as an admin changing `account_status` mid-exam; that path requires an **explicit attempt disposition** ([exam-state-machine.md](exam-state-machine.md)).

## Admin permissions

`is_admin()` remains `profiles.role = 'admin'` (definer; avoids RLS recursion). It gates **entry to the admin surface and admin SELECT**, not every write.

Mutations of consequence go through SECURITY DEFINER RPCs that call `has_permission(code)` (Main Admin ⇒ all codes). UI hiding is UX only.

Permission codes (seeded catalog; RPCs check these names):

- `manage_admins` — create/remove admins, grant/revoke permissions (not the last Main Admin)
- `manage_system_settings` — including payment instructions
- `view_students`
- `manage_students` — profile fields that admins may edit (not self-serve role)
- `activate_students` — restore to `active`
- `restrict_students` — set restricted / suspended / deactivated / revoked (and kick)
- `manage_subscriptions` — activate, deactivate, extend, shorten, assign plan/dates
- `review_subscription_applications` — approve/reject, view amount and screenshot
- `manage_payment_settings`
- `grant_resource_access` — grants and resource-level restrictions
- `manage_year_changes` — approve/reject class-change requests; `promote_student`
- `edit_questions`
- `import_questions`
- `publish_tests`
- `manage_materials`
- `view_analytics`

An Academic/MCQ preset that has only question/test codes **must fail** student, subscription, and year-change RPCs, and must **not** have PostgREST `UPDATE`/`INSERT`/`DELETE` on those tables.

Creating admins: server-side Auth Admin `createUser` (Cloud) plus a DB RPC that sets `role = 'admin'` and permission rows. Service role stays server-only.

Admin-management primitives (authorization in Postgres; admin UI is separate):

- `grant_admin_permission(admin_id, code)` / `revoke_admin_permission(admin_id, code)` — `manage_admins`; audit-logged
- `set_admin_role(user_id, is_admin)` — promote to `role=admin` with `is_main_admin=false` and no extra codes, or demote to student (clears permission rows). Cannot demote the last Main Admin.
- `set_main_admin(user_id, is_main)` — `manage_admins`; target must already be `role=admin`
- `grant_access` / `revoke_access` / `restrict_access` / `unrestrict_access` / `set_resource_entitlement` — `grant_resource_access` (replaces direct `access_grants` / `access_restrictions` / entitlement-column writes)
- `create_subscription_plan` / `update_subscription_plan` / `activate_subscription` / `extend_subscription` / `set_subscription_end` / `deactivate_subscription` / `restore_subscription` / `assign_subscription_plan` — `manage_subscriptions`
- `create_subscription_application` / `update_pending_subscription_application` / `allocate_payment_screenshot_object_key` / `authorize_payment_screenshot_access` / `get_payment_instructions` — authenticated **and** `account_allows_lms()` (own pending / active payment copy). Blocked account statuses cannot read payment instructions. Paid subscription state is independent. Admin screenshot read still uses `review_subscription_applications`.
- `approve_subscription_application` — `review_subscription_applications` **and** `manage_subscriptions` (approval activates/extends)
- `reject_subscription_application` — `review_subscription_applications`
- `upsert_payment_settings` — `manage_payment_settings`

`set_account_status` uses `activate_students` when restoring to `active`, otherwise `restrict_students`. When the target is `role = 'admin'`, `manage_admins` is also required. The last **active** Main Admin cannot be blocked. Question create/version RPCs require `edit_questions` (create also allows `import_questions` so CSV import can insert). Test kill-switch / publish RPCs require `publish_tests`. Enrollment promote/status RPCs require `manage_year_changes`. Analytics RPCs require `view_analytics`. `admin_student_profile` requires `view_students`. `log_audit` remains `is_admin()` so permissioned RPCs can still write the log.

Admin accounts are created from the `/admin/admins` UI (`manage_admins`): Cloud Auth Admin `createUser` (already confirmed) plus `ensure_profile()` as that user, then `set_admin_role` and permission RPCs on the caller session. Promoting an existing student uses `set_admin_role` only. Removing an admin demotes them to student; Auth user-delete remains pending ([deployment.md](deployment.md)).

## Class enrollment (not subscription, not LMS approval)

After email verification, `ensure_profile()` inserts `enrollments.status = 'active'` for the registration year. The student cannot `UPDATE` `year_id`.

Live class: partial unique index `(student_id) WHERE status = 'active'` — one assigned year at a time.

Previous classes: `expired` (promotion or approved year change).

`promote_student(student_id)` remains: expire current, insert `active` for year+1, audit-logged. Requires `manage_year_changes`.

**Year-change requests:** student submits a request for **any** year (`create_year_change_request` / `update_pending_year_change_request`). One pending request per student. Admin approves or rejects (`approve_year_change_request` / `reject_year_change_request`, permission `manage_year_changes`). Approve expires the current class row and inserts `active` for the requested year without changing `account_status`. Students never write `enrollments` directly.

**Migration:** existing `enrollments.status = 'pending'` rows are **auto-activated** (LMS-approval model retired).

Enrollment-level `suspended` / `revoked` are **retired as LMS gates**. Account blocking uses `profiles.account_status`. Mapping of any pre-existing enrollment rows still in `suspended`/`revoked` onto account status is a **pending owner decision** (do not guess in migrations).

## Subscriptions

Not enrollment. Absence of a live subscription row = non-active (free catalog still usable).

- Schema supports **multiple plans**; the product starts with **one** plan. Student apply UI does not need a plan picker yet (implicit current plan).
- At most **one** `subscriptions.status = 'active'` per student.
- `starts_at` / `ends_at` are `timestamptz`. **Server time is authoritative.** Paid-resource live access means `status = 'active' AND now() < ends_at + grace_days`. `grace_days` is `0`, `1`, or `2` (tenant default on `payment_settings.subscription_grace_days`, snapshotted onto the subscription at activate; admin may override per student).
- **Warnings** (in-app, `student_notifications`) fire at **7 / 3 / 1 days before `ends_at`**, not before `grace_until`. Insert helper and uniqueness live here; **8L Student Notification Inbox** contract (and OWNER DECISIONs) are in § “In-app notifications” below.
- After `ends_at`, if grace remains, the account stays usable and **paid resources stay unlocked**. After `grace_until`, paid tests/practice/materials lock; **free** resources stay usable; **account_status is unchanged**.
- Cron/`expire_due_subscriptions()` set `expired` when `now() >= ends_at + grace_days` (not at `ends_at` alone).
- **Renewal** of an still-live row (including during grace) extends `ends_at` from the **existing end date** (not from `now()`). Assigning a period when none is live: `starts_at = now()`, `ends_at` from duration or admin-set dates.
- **`paid_access_mode`** on the live subscription: `all_entitled` (default — paid entitlement + grants) or `grants_only` (paid resources require an unrevoked `access_grants` row; free entitlement still works). Deny-restrictions still win. Grants never override a blocked account.
- **Complimentary** access is a plan (and/or individual **grants**). Not a hard-coded student flag on `profiles`.

### Applications (manual bank transfer; no payment gateway)

Student: Get Subscription → configured payment instructions → enter **amount** → upload screenshot → submit. Admin decides whether the amount is acceptable.

| Application status | Meaning |
|---|---|
| `pending` | Unresolved. Student may **edit/resubmit** this same row (amount, screenshot). One pending per student (partial unique). |
| `approved` | Terminal. Creates/activates/extends the subscription. |
| `rejected` | Terminal for that row. Student may submit a **new** application. |
| `cancelled` | Abandoned pending row (if used). |

Screenshot: **private Cloudflare R2** object key only (`payment-proofs/{tenant}/{student}/{uuid}`). Never a permanent public URL. Authorized admins fetch via short-lived signed GET after `authorize_payment_screenshot_access`.

Payment copy lives in `payment_settings` (Main Admin / `manage_payment_settings`), not hardcoded. Default currency is **PKR**.

Admin lists are queries: Applied (`pending` applications), Active (live subscriptions), Non-active (no live subscription).

## Resource access

Do **not** hard-code “paid = menu X”. Menus stay visible. **Catalog visibility** (see the item, lock state) is separate from **content entitlement** (use it).

**Account-level blocking always overrides** resource access: non-`active` accounts get no LMS catalog and no content RPCs (except the explicit in-progress exam disposition in [exam-state-machine.md](exam-state-machine.md)).

For an **active** student, evaluate:

1. Catalog: **current** assigned class year (and test audience / equivalent) **or** an allow-grant that names the item. Unpublished tests stay hidden. After an approved year change, previous-year catalog rows disappear unless explicitly granted. Guessing another year’s id via PostgREST/RPC must return no row / RPC denial — not a UI-only hide.
2. **Deny** (`access_restrictions`, unrevoked) → cannot use. **Deny wins** over grant and subscription.
3. **Allow** (`access_grants`, unrevoked) → can use (still subject to deny and `account_allows_lms()`). Off-year grants are the only way to keep a previous year’s item after a year change.
4. Else resource entitlement: `free` | `any_subscription` | `plan` (specific `required_plan_id`), using live subscription **including grace**. If the student’s live subscription is `paid_access_mode = grants_only`, paid entitlement does **not** unlock; only a grant (or free entitlement) can.

Locked paid items remain **listed** with a lock. Secrets (Drive URL, signed URL, question payload, `correct_key`) must not ride on catalog SELECT. Content RPCs (`start_attempt` new starts, practice fetch, `open_material`, `get_attempt_review` items, future signed book/video URL) enforce entitlement. Owned score/result summary is not a content start.

**Practice:** Main Admin configures **each subject** as free / subscription / plan. Do not hard-code practice as always free or always paid.

**Compatibility:** existing tests, material folders, and practice subjects are backfilled to entitlement **`free`** so current year-based access is preserved. New resources may be free, subscription-required, or plan-specific.

**Note:** today’s practice UI already lists subjects with a lock unless `access_grants(practice_subject)` exists. After backfill to `free`, those existing subjects become usable without a grant unless the admin reconfigures entitlement or adds a restriction. Grants remain the allow overlay.

Future books/videos use the same visibility/entitlement split and **protected temporary URLs** after an access check ([architecture.md](architecture.md)).

## In-app notifications

Subscription expiry warnings at **7 days**, **3 days**, and **1 day** before `ends_at`. **In-app only** for now (`student_notifications`). No Brevo transactional subscription mail. `emit_subscription_expiry_warnings()` inserts rows (lazy from `expire_due_subscriptions`). Uniqueness `(student_id, kind, ref_id)` prevents repeat spam for the same subscription + kind. After `ends_at`, remaining access is grace only — no further pre-expiry warnings.

Auth email (Brevo SMTP for GoTrue) remains signup/reset only.

### 8L — Student Notification Inbox (canonical product/UX contract)

**Scope:** student-facing inbox for rows already stored in `student_notifications`. Backend foundation (table, RLS, `read_at`-only updates, emit helper, lazy emission) is **pre-8L** and must not be redesigned here. **Do not implement** until the **OWNER DECISION** items below are resolved (or explicitly waived in a follow-on doc approval).

#### Settled (already in schema / RLS / emission law)

| Topic | Contract |
|---|---|
| Kinds | At least `subscription_expiry_7d`, `subscription_expiry_3d`, `subscription_expiry_1d` (CHECK-constrained). |
| When rows appear | When `ends_at` is still in the future and remaining time is ≤ 7 / 3 / 1 days respectively; keyed off **`ends_at`**, not `grace_until`. |
| Uniqueness | One row per `(student_id, kind, ref_id)`; `ON CONFLICT DO NOTHING` on emit. |
| Payload written today | `jsonb` with at least `ends_at` and `grace_days` from the subscription row at emit time. |
| Student mutations | May **UPDATE own** rows; immutability trigger allows changing **`read_at` only** (not `kind`, `ref_id`, `payload`, `student_id`, `tenant_id`). |
| Student reads | SELECT own rows only (`student_id = auth.uid()`). |
| Admin | **SELECT** any notification (support / audit). No admin inbox UI is required for 8L. |
| Inserts | Not student-writable; produced by `emit_subscription_expiry_warnings` (security definer). |
| Deletes | No student DELETE policy; inbox must not invent client deletes. |
| Lazy emission | `expire_due_subscriptions` already calls `emit_subscription_expiry_warnings` for the scoped student (or admin/null batch). That path remains. |
| Infrastructure | No Redis, queues, or Realtime required for 8L. Normal navigation / page refresh is sufficient unless an OWNER DECISION below requires something else. SessionWatch polling is unrelated. |

#### Human-readable kind meaning (presentation law)

| `kind` | Meaning (must convey) |
|---|---|
| `subscription_expiry_7d` | Live subscription ends within **7 days** (`ends_at`). |
| `subscription_expiry_3d` | Live subscription ends within **3 days** (`ends_at`). |
| `subscription_expiry_1d` | Live subscription ends within **1 day** (`ends_at`). |

Exact English copy strings are **OWNER DECISION** (below). Do not invent marketing copy in migrations.

#### Allowed / forbidden display data

**Allowed for the owning student:** `kind`, `created_at`, `read_at`, `ref_id` (as opaque subscription id), and payload fields already stored for that row (`ends_at`, `grace_days`). Showing that the warning is about **their** subscription expiry timing is in scope.

**Forbidden:** another student’s notifications; forging `student_id`; displaying secrets (payment screenshots, service keys, JWTs); using the inbox to leak classmate scores, review content, or `correct_key`; treating payload as entitlement authority (live access remains time-of-read helpers / RPCs).

#### Read semantics (partially settled)

| Behavior | Contract |
|---|---|
| Unread | `read_at IS NULL`. |
| Mark one read | Student sets `read_at` to server time on **own** row (via allowed UPDATE or a thin RPC that only sets `read_at`). |
| Mark all read | **OWNER DECISION** whether 8L requires it. |
| Re-open as unread | **OWNER DECISION** whether clearing `read_at` is allowed. Default until decided: **do not** expose “mark unread” (schema allows null `read_at`, but product may keep read permanent). |
| Sort | Newest first (`created_at desc`), matching the existing student index intent. |

#### Admin scope

8L delivers a **student inbox only**. Preserve admin **SELECT** on `student_notifications`. Do not build an admin notification console in 8L unless a later doc explicitly adds it.

#### Security / privacy (must hold in any 8L UI)

1. Student sees **only** own notifications (RLS).
2. Only **`read_at`** may change on update.
3. No cross-student access via URL params, shared queries, or admin-impersonation shortcuts in the student app.
4. Payload must not be expanded with unauthorized joins (e.g. do not attach other students’ data to `ref_id`).
5. App checks are UX only; Postgres remains the boundary.

#### Cron (explicit)

**pg_cron emission is not required to ship the 8L student inbox.** Docs previously called it “optional” / “future.” Contract:

- **8L MVP:** lazy emission via existing `expire_due_subscriptions` → `emit_subscription_expiry_warnings` remains sufficient for correctness of *when a row may exist*.
- **Optional later:** an operator-configurable pg_cron (or systemd timer calling the same emit helper) may be added under [deployment.md](deployment.md) with separate approval. That job must target **staging/production rules already documented for cron**, must not invent new kinds, and is **out of 8L implementation** until approved.
- Do **not** implement cron as part of documenting or coding the inbox until that approval exists.

#### OWNER DECISION (block implementation until resolved)

Do not guess these in UI or migrations:

1. **Inbox route path** (e.g. whether `/notifications` or another student path under the existing App Router layout).
2. **Navigation label** and whether the item appears in desktop sidebar, mobile “More” drawer, and/or bottom tabs (current student nav pattern lives in `src/app/(student)/layout.tsx` — pattern only, not a chosen label).
3. **Exact title/body copy** for each of the three kinds (must still match the meaning table above).
4. **Deep link target** when a row is opened/activated: e.g. `/subscription`, dashboard, nowhere (informational only), or another settled student route. Do not invent a new product surface.
5. **Whether opening the inbox (and/or dashboard) must call `emit_subscription_expiry_warnings` for `auth.uid()`**, or whether emission stays solely on the existing lazy `expire_due_subscriptions` path.
6. **Mark all as read** — required in 8L or not.
7. **Mark unread / clear `read_at`** — allowed or forbidden.
8. **Unread badge** — required or not; if required, where (nav item only, layout chrome, both).
9. **Empty-state copy** — exact wording (**OWNER DECISION**). Spec-level requirement: empty state must exist and must not imply system failure when the student simply has zero rows.
10. **Pagination / retention UI** — whether the inbox lists all historical warnings forever or applies a product limit (**OWNER DECISION**; schema has no retention job today).

When these are decided, record the choices in this section (replace OWNER DECISION bullets with settled values) **before** implementing UI/routes.

## DB helpers (security definer, `set search_path = public`)

- `is_admin()` — `profiles.role = 'admin'` for `auth.uid()`. Policies/RPC entry; not a substitute for `has_permission`.
- `is_main_admin()` — `is_main_admin` on the caller’s profile.
- `has_permission(code)` — Main Admin or (`is_admin()` and a matching `admin_permissions` row). Never `user_metadata` / frontend state.
- `require_permission(code)` — raises `admin only` for non-admins, `permission_denied` for admins missing the code.
- `account_allows_lms()` — `account_status = 'active'` for the caller.
- `is_active_session()` — JWT session_id = `profiles.active_session_id` **OR** the session owns an `in_progress` attempt (Layer 2 exemption). Portal use also requires `account_allows_lms()` except where an explicit exam disposition keeps Layer 2 alive ([exam-state-machine.md](exam-state-machine.md)).
- `has_active_enrollment(p_year_id)` — live **class** enrollment (`status = 'active'`) for `auth.uid()` in that year. Not subscription.
- `has_live_subscription()` / `has_live_plan(p_plan_id)` — caller’s `subscriptions` row with `status = 'active' AND now() < ends_at + grace_days`, and `account_allows_lms()`. Time-of-read is authoritative; delayed cron cannot grant access. `expire_due_subscriptions()` (cron + lazy) normalizes `active` → `expired` after grace.
- `resource_content_allowed(...)` — central content evaluator after catalog visibility: account active, then deny-restriction, then allow-grant, then `free` / live subscription / matching plan (skipped for paid kinds when `paid_access_mode = grants_only`).
- `can_view_test(p_test_id)` — catalog visibility (published/closed + year audience or allow-grant). Does **not** by itself authorize `start_attempt`, owned result pages, or review.
- `can_access_test(p_test_id)` — **content** entitlement: `can_view_test` AND `resource_content_allowed`. **New** `start_attempt` uses this (plus session, account, window). Resume of `in_progress` skips it ([exam-state-machine.md](exam-state-machine.md)).
- `get_attempt_review(p_attempt_id)` — SECURITY DEFINER review payload. Owner or admin; `show_review`; **and** for paid tests the caller must have **live** content entitlement (`resource_content_allowed`) before stems, selected keys, correct keys, or explanations are returned. Denied paid review is `{ allowed: false, reason: 'review_locked_entitlement' }` with **no items**. Score/result summary is not this RPC. After expiry, renewal may restore review; it never rescores.
- `get_own_test_result(p_test_id)` — SECURITY DEFINER historical **score / % / summary** for the caller’s own `submitted` attempt (`student_id = auth.uid()`, `test_id = p_test_id`). Independent of current `can_view_test`, entitlement, catalog year, and `can_access_test`. Returns `null` when the caller has no submitted attempt (including in-progress-only). Does **not** accept a client student id or attempt id; does **not** return review items. Admin viewing others uses admin SELECT / `get_attempt_review`, not this RPC.
- `can_view_practice_subject` / `has_practice_access` — catalog vs content for practice subjects (`practice_subjects().granted` is the content flag).
- `can_view_material_folder` / `can_access_material_folder` / `open_material(id)` — catalog vs content for materials. `open_material` is the only student path to `drive_url`.
- `ensure_profile()` — idempotent; profile UUID = `auth.uid()`. Inserts/updates email and full_name from JWT claims; never writes `role` / `is_main_admin`. Creates an **active** enrollment from `user_metadata.year_id` when that year exists and the student has no live `active` enrollment.
- `bootstrap_first_main_admin()` — caller becomes Main Admin **only if** no Main Admin exists. One-time bootstrap; additional admins use `set_admin_role`.

These helpers stay valid on VPS PostgREST because they depend on JWT GUCs + `public` tables, not on a local `auth` schema of users.

## RLS matrix (deny-by-default; only listed access exists)

Admin **SELECT** may use `is_admin()`. Admin **INSERT/UPDATE/DELETE** on sensitive tables is **RPC-only** with `has_permission`. Do not keep blanket `FOR ALL USING (is_admin())` on enrollments, subscriptions, applications, grants, restrictions, profiles status/role, or payment settings.

| Table | student | admin |
|---|---|---|
| profiles | SELECT/UPDATE own row (role, account_status, is_main_admin protected) | SELECT; status/role/main-admin via RPCs |
| admin_permissions / permissions | none | SELECT own/all if `is_admin()`; writes via `manage_admins` RPCs |
| years/subjects/books/chapters/topics | SELECT current assigned year (account active); subjects/books/chapters/topics also if a live practice grant names that subject | SELECT; writes: `is_admin()` until a dedicated curriculum permission is approved (see pending owner decision). Not a student-data write. |
| questions | no direct SELECT (RPC only) | SELECT if `is_admin()`; INSERT/UPDATE/DELETE if `has_permission('edit_questions')`; create/version RPCs check the same codes |
| question_versions | no direct SELECT (RPC only); no UPDATE/DELETE for anyone | SELECT if `is_admin()`; INSERT if `has_permission('edit_questions')` |
| enrollments | SELECT own | SELECT; writes via year-change / promote RPCs |
| year_change_requests | SELECT own; insert/update pending via RPC | SELECT; approve/reject RPC |
| access_grants / access_restrictions | SELECT own | SELECT; grant/revoke RPCs |
| subscription_plans / payment_settings | SELECT active plans / current payment copy via RPC or read policy | SELECT; writes via payment/plan RPCs |
| subscriptions | SELECT own | SELECT; activate/extend RPCs |
| subscription_applications | SELECT own; create/edit pending via RPC | SELECT; review RPCs |
| student_notifications | SELECT/UPDATE own (read_at) | SELECT |
| test_audiences | SELECT via viewable tests | SELECT if `is_admin()`; writes if `has_permission('publish_tests')` |
| tests | SELECT where `can_view_test(id)` (locked paid still listed). Owned historical **result** must not depend on this policy ([access-eligibility-analytics.md](access-eligibility-analytics.md) §15) | SELECT if `is_admin()`; INSERT/UPDATE/DELETE if `has_permission('publish_tests')`; publish/kill-switch RPCs check the same code |
| test_questions | none (RPC only) | SELECT if `is_admin()`; writes if `has_permission('publish_tests')` (immutability by trigger) |
| test_attempts | SELECT own; **no INSERT/UPDATE/DELETE** (RPC only) | SELECT; invalidate RPC |
| attempt_answers | **none** (RPC only — `save_answer` / scoring / `get_attempt_review`). Direct student SELECT is forbidden so post-expiry review cannot be bypassed | SELECT |
| practice_seen / practice_answers | via RPC; SELECT own | SELECT |
| material_folders | SELECT catalog for assigned year / grants | SELECT if `is_admin()`; writes if `has_permission('manage_materials')` |
| materials | SELECT **without** `drive_url`; open via `open_material` | SELECT metadata if `is_admin()` (`drive_url` via `open_material`); writes if `has_permission('manage_materials')` |
| rank_dirty_queue | none | none (SECURITY DEFINER RPCs only) |
| audit_logs | none | SELECT; insert via `log_audit` from permissioned RPCs (`log_audit` stays non-student) |
| import_* | none | `import_questions` |
| question_stats / test_stats | none | `view_analytics` SELECT |

Hard guarantees a student must NEVER bypass (tested in pgTAP):
- read another student's profile/attempts/answers/enrollment/subscription/application/results
- read any question's `correct_key`/`explanation` before answering (exam) or answering (practice)
- **use** an unpublished test, a denied resource, or a paid resource without entitlement (`start_attempt` / content RPCs fail server-side)
- read paid **review content** (stems, own `selected_key`, `correct_key`, explanations) after entitlement expiry — `get_attempt_review` and table RLS must deny; blur/lock is UX only. Owned **score / % / result summary** remains visible
- write questions, tests, grants, restrictions, subscriptions, or their own `role` / `account_status`
- mutate attempts outside the RPCs
- read a permanent public payment-screenshot URL

PostgREST on the VPS is the same trust model as today's hosted Data API: table grants exist, **RLS and RPC guards are the security boundary**. `service_role` bypasses RLS and stays off the browser. Entitlement is **not** stored in the JWT; RPCs re-read the database (no cached paid access after expiry).

## Pending owner decisions

Do not guess these in migrations:

1. **Pre-existing `enrollments.status` in `suspended` or `revoked`:** how to map onto `profiles.account_status` vs leave historical enrollment rows only.
2. **Curriculum tree CRUD permission code:** years/subjects/books/chapters/topics writes stay `is_admin()` until a dedicated code is approved (not in the seeded list above).
3. **R2 bucket name** for payment screenshots (private R2 is approved; prefix is `payment-proofs/`). Production requires dedicated `R2_PAYMENT_BUCKET` (no fallback to backup `R2_BUCKET`). Non-production may use `R2_PAYMENT_BUCKET` or `R2_BUCKET`.
4. **Application `cancelled`:** whether the student UI exposes cancel, or only admin/system uses it. The status exists; no cancel RPC/UI in this step.
5. **R2 object retention** after reject/replace/orphan upload: no lifecycle rule is configured.
6. **8L Student Notification Inbox UX** — route path, nav label/placement, exact kind copy, deep-link target, emit-on-inbox/dashboard-load vs lazy-only, mark-all, mark-unread, unread badge, empty-state wording, list retention/pagination. Settled backend/security rules and the OWNER DECISION list: § “8L — Student Notification Inbox” above. Optional pg_cron emit is **not** part of 8L MVP.
