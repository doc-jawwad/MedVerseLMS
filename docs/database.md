# Database Schema (canonical)

Conventions: every table has `id uuid primary key default gen_random_uuid()`, `tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger-maintained). RLS enabled on **every** table, deny-by-default. State columns are text enums via CHECK — never boolean flags.

## Identity

**profiles** — pk = Auth JWT `sub` (UUID). No foreign key to `auth.users` (required for a VPS `public` schema whose Auth lives in Cloud; `handle_new_user()` still runs when Auth and `public` share a database). `full_name`, `email`, `role text check (role in ('admin','student')) default 'student'`, `account_status text check in ('active','restricted','suspended','deactivated','revoked') default 'active'`, `is_main_admin boolean not null default false`, `active_session_id uuid`, `last_login_at timestamptz`.
- Created by trigger `handle_new_user()` on `auth.users` insert when Auth is co-located, and/or by idempotent `ensure_profile()` from the authenticated JWT. Role always `'student'` on insert. `ensure_profile()` never writes `role`, `is_main_admin`, or `account_status` on update (insert default `active`).
- Triggers block student changes to `role`, `account_status`, and `is_main_admin`. Blocking `account_status` transitions must clear `active_session_id` (Layer 1 kick).
- At most one remaining Main Admin: the last `is_main_admin` row cannot be demoted/removed (RPC + constraint/trigger). The last **active** Main Admin cannot be blocked via `set_account_status`. First access-model migration: every existing `role = 'admin'` becomes Main Admin.
- Other admins: `role = 'admin'` plus `admin_permissions` rows. See [permissions.md](permissions.md).
- Dev/test accounts: use `node scripts/create-dev-account.mjs` (Auth Admin API, already-confirmed, no email round trip). PostgREST uses the new user's access token (and anon `list_years()`), never an opaque `sb_secret_*` Bearer. `ensure_profile()` creates the profile and **active** class enrollment. `--admin` calls `bootstrap_first_main_admin()` when no Main Admin exists. Not the real `/register` form — see docs/deployment.md "Auth emails" for why.

**permissions** — catalog of permission codes (`code text primary key`, label). Seeded; not edited by students.

**admin_permissions** — `admin_id` → `profiles`, `permission_code` → `permissions`. Unique `(admin_id, permission_code)`. RLS: no student access; writes only via `manage_admins` RPCs (`grant_admin_permission` / `revoke_admin_permission`). Main Admin is authorized even with zero rows (`has_permission` short-circuits). Promote/demote: `set_admin_role`, `set_main_admin` (last Main Admin cannot be removed).

## Curriculum

`years` (year_number 1–5 unique, name) → `subjects` (year_id, name, sort_order; unique (year_id,name)) → `books` (subject_id, name, sort_order) → `chapters` (book_id, name, sort_order, **denormalized subject_id, year_id**) → `topics` (chapter_id, name, sort_order, **denormalized book_id, subject_id, year_id**).

Denormalized ids keep RLS join-free; maintained by trigger from the parent on insert/update.

## Question bank

**questions** — identity row (content lives in versions):
- `topic_id` + denormalized `chapter_id, book_id, subject_id, year_id`
- `current_version_id uuid` (fk question_versions, deferred)
- `status text check in ('draft','review','approved','needs_revision','archived') default 'draft'`
- `difficulty text check in ('easy','medium','hard')`
- `tags text[]`, `content_hash text` (unique — normalized md5 of stem+options+correct), `stem_normalized text` (trigram index)
- `used_in_test boolean default false` — **derived UI cache ONLY.** Authoritative truth = existence of a published `test_questions` row. Never use for security, eligibility, or historical truth. May be refreshed from test_questions at any time.
- `created_by uuid`

Workflow: draft → review → approved → archived; any state may drop to `needs_revision`. Only `approved` questions are eligible for tests and practice.

Status transitions are now enforced at the database level (`protect_question_status_transition()` trigger, `before update of status`, `20260913000005_question_status_transition_guard.sql`) — not app-code-only. The exact enforced graph (unchanged from the pre-existing `allowedTransitions` map in `src/lib/actions/questions.ts`, now also DB-guaranteed): `draft → {review, approved, archived}`, `review → {approved, needs_revision, draft, archived}`, `approved → {needs_revision, archived}`, `needs_revision → {review, approved, archived}`, `archived → {draft}`. **Note:** this graph is slightly richer than the one-sentence summary above (e.g. `draft`/`archived` cannot go directly to `needs_revision`; `review`→`draft` and `needs_revision`→`review`/`approved` are additionally allowed) — this predates the DB trigger and is preserved as-is rather than resolved in either direction, per this project's "change the doc first, with approval" convention (AGENTS.md).

**question_versions** — **immutable, append-only**:
- `question_id`, `version_no int` (unique per question), `stem text`, `options jsonb` (array of `{key:'A'..'E', text}` — 4 or 5 entries), `correct_key char(1)`, `explanation text`, `reference text`
- UPDATE/DELETE blocked by trigger (raises) AND absent RLS policies.
- Editing a question = `create_question_version(question_id, ...)` fn: inserts version_no = max+1, updates `questions.current_version_id`, `content_hash`, `stem_normalized` atomically.

`correct_key`/`explanation` must never reach a student before they answer: exam questions served via RPC that omits them; practice answers checked server-side by RPC.

## Enrollment (class assignment — not subscription, not LMS approval)

**enrollments** — `student_id`, `year_id`, `status check in ('active','expired')`, `approved_by`, `approved_at`, `expires_at`.
- This row is the student’s **assigned MBBS year**. It is not payment and not “admin approved to enter the LMS.”
- Partial unique index: `(student_id) WHERE status = 'active'` — one live class.
- After email verification, `ensure_profile()` / `handle_new_user()` insert `status = 'active'` when `user_metadata.year_id` names a real year and the student has **never** had any enrollment row (first provision only). Students have no direct INSERT/UPDATE/DELETE.
- `promote_student(student_id)`: sets active row `expired`, inserts active row for year+1. Audit-logged. Requires `manage_year_changes`.
- **Migration:** existing `status = 'pending'` rows are **auto-activated**. Enrollment `pending` is not used going forward. Pre-existing `suspended`/`revoked` enrollment rows: mapping onto `profiles.account_status` is a **pending owner decision**.

**year_change_requests** — `student_id`, `from_year_id`, `to_year_id` (any year), `status check in ('pending','approved','rejected')`, `reason text`, `reviewed_by`, `reviewed_at`, `review_note text`.
- Partial unique: `(student_id) WHERE status = 'pending'`.
- Student creates/updates only own `pending` row via RPC (`create_year_change_request` / `update_pending_year_change_request`). Requires `account_allows_lms()`.
- Approve (`manage_year_changes`): expire current live enrollment, insert `active` for `to_year_id`, audit. Does **not** change `profiles.account_status` or subscriptions.
- Reject (`manage_year_changes`): terminal for that row; student may submit a new request.

## Subscriptions & applications

**subscription_plans** — `name`, `description`, `duration_days int`, `is_complimentary boolean not null default false`, `is_active boolean not null default true`, sort order.
- Schema supports multiple plans. Product starts with **one** plan (plus optional complimentary plan(s)). Complimentary access is a plan (and/or grants), **not** a flag on `profiles`.

**subscriptions** — `student_id`, `plan_id`, `status check in ('active','expired','deactivated')`, `starts_at timestamptz not null`, `ends_at timestamptz not null`, `grace_days int not null default 0 check (grace_days in (0,1,2))`, `paid_access_mode text not null default 'all_entitled' check in ('all_entitled','grants_only')`, `application_id uuid null`, `activated_by`, `activated_at`, `deactivated_by`, `deactivated_at`.
- CHECK `starts_at < ends_at`. Partial unique `(student_id) WHERE status = 'active'`. Index `(ends_at) WHERE status = 'active'`.
- Live entitlement: `status = 'active' AND now() < ends_at + grace_days` (server clock). `expire_due_subscriptions()` sets `expired` when `now() >= ends_at + grace_days`. Access helpers do **not** wait for that UPDATE.
- Renewal while still live (including grace): **update the existing active row** `ends_at := ends_at + duration` (from **existing end**, not `now()`). Do not insert a second active row. New period when none live: insert a new `active` row with `starts_at = now()`, `ends_at` from duration or admin dates; previous expired/deactivated rows remain history. Admin mutations write `audit_logs`.
- `paid_access_mode = grants_only`: paid (`any_subscription` / `plan`) resources require a live grant; free entitlement still applies. `all_entitled` is the default overlay.
- Students SELECT own rows only. Writes via admin RPCs (`manage_subscriptions`).

**subscription_applications** — `student_id`, `plan_id` (nullable until the single initial plan is implied/filled by RPC), `amount numeric not null check (amount > 0)`, `currency text not null default 'PKR'`, `screenshot_object_key text not null`, `status check in ('pending','approved','rejected','cancelled')`, `reviewed_by`, `reviewed_at`, `review_note`.
- Partial unique `(student_id) WHERE status = 'pending'` — no simultaneous pending applications.
- While `pending`, the student may edit/resubmit **that row** (amount, screenshot) via RPC.
- `approved` is terminal and creates/activates/extends a subscription. `rejected` is terminal; student may insert a **new** application.
- Screenshot bytes live in **private Cloudflare R2**; the table stores only the object key (`payment-proofs/{tenant_id}/{student_id}/{uuid}`). Never a public URL. Admin review uses a short-lived signed GET after `authorize_payment_screenshot_access` (`review_subscription_applications`). On **replace**, the previous object is deleted after a successful update. On **reject**, the object is deleted after a successful reject (private proofs are not retained in R2). Failed attach after upload discards the new object only when `authorize_payment_screenshot_discard` allows it (orphan keys; never a key still attached to any application status).
- Currency default is **PKR** (owner decision). Copied from `payment_settings.currency` when the student omits it.
- No payment gateway. Admin decides whether `amount` is acceptable.

**payment_settings** — one row per tenant: `bank_name`, `account_title`, `account_number`, `iban`, `payment_instructions`, `qr_reference`, `currency text not null default 'PKR'`, `is_active`, `subscription_grace_days int not null default 0 check in (0,1,2)`. Configured by `manage_payment_settings`. Active accounts read the **active** copy via `get_payment_instructions()` (`account_allows_lms()`). Restricted/suspended/deactivated/revoked callers are rejected. Not hardcoded. Subscription expiry is independent of this gate. Tenant grace is the default copied onto new subscription rows.

## Resource entitlement, grants, restrictions

Each student-facing resource kind carries the same entitlement shape (columns on the resource row **or** a side table with unique resource key — implementation may choose one layout; semantics are identical):

- `entitlement text check in ('free','any_subscription','plan')` default `'free'`
- `required_plan_id uuid null references subscription_plans` — required iff `entitlement = 'plan'`.

Applies to **tests**, **material_folders**, **practice subjects** (`subjects`), and **pearl_points**. Main Admin configures each practice subject independently. Do not hard-code practice or pearls as always free or always paid. PDF files and text guidelines inherit **folder** entitlement — they are not a second policy.

**Compatibility backfill:** existing tests, material folders, and practice subjects default to `entitlement = 'free'` so current year-based access is preserved. New resources may be free, subscription-required, or plan-specific.

**access_grants** — allow overlay. `student_id`, `grant_type check in ('practice_subject','test','materials_folder')` (extend later for `pearl_point` / `book` / `video` when per-student pearl grants are needed), `subject_id`, `test_id`, `folder_id`, `granted_by`, `revoked_at` (null = live). CHECK: exactly one target column non-null and matching grant_type. Unique live target `(student_id, grant_type, coalesce(subject_id, test_id, folder_id)) WHERE revoked_at is null`. Pearl **item** access in this phase uses the same entitlement columns on `pearl_points` (plus year enrollment). Per-student pearl grant/restriction overlay is deferred — do not duplicate pearls into `questions`.

**access_restrictions** — deny overlay. Same target shape as grants (`resource_kind` + matching id column, `student_id`, `set_by`, `revoked_at`). Unique live target. Writes via `restrict_access` / `unrestrict_access` (`grant_resource_access`). **Deny wins** over grant and subscription. Applies to an otherwise **active** account; it is not `profiles.account_status = 'restricted'`.

**test_audiences** — `test_id`, `year_id`: year-cohort **catalog** membership for a test. Content still needs entitlement (and not denied). Per-student `access_grants(test)` remains the extra/allow path (including off-year).

Helpers: `can_view_test` (catalog) vs `can_access_test` (content); `resource_content_allowed` is the shared evaluator. See [permissions.md](permissions.md). Entitlement column changes go through `set_resource_entitlement`. Historical eligibility, missed tests, and analytics: [access-eligibility-analytics.md](access-eligibility-analytics.md).

## Notifications (in-app)

**student_notifications** — `student_id`, `kind text` (at least `subscription_expiry_7d`, `subscription_expiry_3d`, `subscription_expiry_1d`), `ref_id uuid` (subscription id), `payload jsonb` (emit stores `ends_at`, `grace_days`), `read_at timestamptz null` (null = unread), `created_at`. Unique `(student_id, kind, ref_id)`. Inserted by `emit_subscription_expiry_warnings()` (lazy from `expire_due_subscriptions`). Student SELECT/UPDATE own; updates may change **`read_at` only** (immutability trigger). Admin SELECT. No student INSERT/DELETE. No Brevo transactional subscription email. Warnings use `ends_at`, not `grace_until`.

**8L Student Notification Inbox** (route, nav, copy, badge, mark-all, deep links, optional emit-on-load, optional pg_cron): product/UX contract and **OWNER DECISION** list live in [permissions.md](permissions.md) § “8L — Student Notification Inbox”. Schema above is the data foundation; do not invent inbox UX in migrations. pg_cron emission is **not** required for 8L MVP and stays separately approved / operator-configurable if added later.

## Audit

**audit_logs** — `actor_id`, `action text`, `target_type text`, `target_id uuid`, `details jsonb`, `created_at`. Insert-only via `log_audit()`. **Students cannot call `log_audit()`.** Student-originated applications/year-change requests are history on those tables; admin approve/reject/activate/extend/restrict/grant/year-change/admin-permission changes write `audit_logs`. Index `(action, created_at desc)` in addition to existing `(created_at desc)` and `(target_type, target_id)`.

## Tests

**tests** — `title`, `year_id`, `subject_id null`, `status text check in ('draft','published','closed','archived','invalidated') default 'draft'`, `opens_at`, `closes_at`, `duration_minutes int`, `marks_per_question numeric(6,2) default 1`, `negative_mark numeric(4,2) default 0`, `shuffle_questions bool default true`, `shuffle_options bool default false`, `show_review text check in ('after_submit','after_close','never') default 'after_close'`, `min_questions int default 1`, `created_by`, plus entitlement columns (`free` / `any_subscription` / `plan`; existing rows backfilled `free`).
("live" is derived: `status='published' and now() between opens_at and closes_at` — not a stored state.)
Student-facing **Free / Both / Paid / Neither** audience in the test form maps onto these entitlement columns (not a new enum): Free and Both → `free` (subscription never removes free access; Both is the same access law as Free); Paid only → `any_subscription`; Neither → remain `draft` (unpublished tests are never in the student catalog). `test_audiences` remains year-cohort catalog membership.

**test_prep_guidelines** — `test_id` PK → `tests` (`ON DELETE CASCADE`), `body_text`. Optional preparation / study notes for a test. No student table SELECT (`get_test_prep_guidelines` / `accessible_test_prep` after `can_access_test`). Writes allowed only while the test is `draft` (frozen after publish, same idea as `protect_published_test`). History keeps the row attached after submit/close; body still requires live content entitlement.
- `rank_dirty_at timestamptz` — leftover coalesced-ranking drain source for older writers. New scoring must **not** `UPDATE` this column; `rank_dirty_tests()` still clears it when set.

**rank_dirty_queue** — append-only dirty signal that a test's `rank`/`percentile` needs recomputation. `test_id` → `tests` (`ON DELETE CASCADE`). `score_attempt` inserts one row; `rank_dirty_tests()` distinct-drains then calls `rank_test` once per test. No student/admin table access (SECURITY DEFINER RPCs only). Concurrent same-test submits must not serialize on the `tests` row for this signal ([scoring-rules.md](scoring-rules.md)).

**test_questions** — `test_id`, `question_id`, `question_version_id` (**frozen at publish**), `position int`, `marks numeric null` (override), `voided bool default false`, `void_policy text check in ('exclude','credit_all') null`. Unique (test_id, question_id). Immutable after publish except `voided`/`void_policy` (trigger-enforced).

## Attempts

**test_attempts** —
- `test_id`, `student_id`, `state text check in ('in_progress','submitted','invalidated')`
- **Partial unique index `(test_id, student_id) WHERE state != 'invalidated'`** — one live/submitted attempt; invalidated history preserved; controlled retake possible.
- `started_at` (server), `expires_at` (server: `least(started_at + duration, closes_at)`), `submitted_at`, `submit_source check in ('student','auto','admin')`
- `device_id uuid not null`, `session_id uuid` (auth session that started it)
- `question_order uuid[]` (shuffled question_version_ids, persisted at start), `option_orders jsonb null`
- `invalidated_reason text`, `invalidated_by uuid` (both required when state='invalidated')
- results: `score numeric`, `raw_correct int`, `raw_wrong int`, `raw_blank int`, `percentage numeric`, `rank int`, `percentile numeric`
- Indexes: (test_id, state), (student_id), partial (state) where in_progress, (test_id, score desc).
- Students have NO direct UPDATE — RPC only.
- Own historical **result summary** is `get_own_test_result(p_test_id)` (SECURITY DEFINER, `auth.uid()` + `state = 'submitted'`). It is not catalog `can_view_test`. Review items stay on `get_attempt_review` (owner requires `account_allows_lms()`; blocked accounts cannot read review; permissioned admins retain access).

**attempt_answers** — `attempt_id`, `question_version_id`, `selected_key char(1) null` (null = cleared), `marked_for_review bool default false`, `answered_at`, `time_spent_ms int`, `save_seq bigint`. **Unique (attempt_id, question_version_id)** → autosave = upsert with `save_seq` monotonic guard.

## Practice

**subjects** carry the same entitlement columns as tests/folders (Main Admin configures each subject; existing subjects backfilled `free`).
**practice_seen** — `student_id`, `question_id`, `cycle int default 1`, `last_seen_at`. Unique (student_id, question_id).
**practice_answers** — `student_id`, `question_version_id`, `selected_key`, `is_correct bool`, `answered_at`, denormalized `subject_id, chapter_id, topic_id`.
Practice list RPCs return catalog rows with a lock flag; start/fetch RPCs enforce entitlement (deny > grant > plan/subscription > free).

## Materials

**material_folders** — `name`, `year_id`, `subject_id null`, `sort_order`, `library_type text check in ('guidelines','ospe_material','ospe_lectures','books','notes','lectures')` (existing folders: guideline-containing → `guidelines`, else `notes`), plus entitlement columns (existing folders backfilled `free`). Folder entitlement is the access policy for every item in the folder. `library_type` is the **student/admin library category** (Books vs Notes vs OSPE vs Lectures). Delivery `materials.kind` is **not** that category.

**materials** — `folder_id`, `title`, `description`, `file_type text`, `kind text check in ('drive','pdf','guideline') default 'drive'`, `status text check in ('draft','published') default 'published'` (existing Drive rows backfilled published), optional `chapter_id` / `topic_id` / `reference_text`, plus kind-specific payload:
- `drive` — `drive_url` https-only (YouTube or Google Drive / other https). No R2 key / body. Students open via `open_material` (never catalog SELECT of the URL).
- `pdf` — private R2 `r2_object_key` under `study-content/`; optional `cover_object_key`; no Drive URL / body.
- `guideline` — `body_text` (markdown/plain); no Drive URL / PDF object.

**Two student surfaces, one store:** Free Resources lists only curated `entitlement = 'free'` items and/or unrevoked personal grants (not restricted) — never paid-only items that a subscriber can open merely via live subscription. Main library hubs list the year catalog for that type. Do not duplicate educational rows to mark free vs paid — use entitlement columns (and grants/restrictions).

Student catalog SELECT must **not** expose `drive_url`, `body_text`, or R2 keys. Table-level `SELECT` is revoked and re-granted on metadata columns only. Students see **published** items in folders they `can_view`. `open_material(id)` returns a Drive URL only for `kind = 'drive'` after student entitlement or `manage_materials`. `open_study_item(id)` returns guideline body (or PDF catalog metadata without the object key) after the same folder content check. `authorize_study_object(id)` returns the R2 key for Next.js to sign; students must not obtain PDF bytes without that path.

## Pearl points

**pearl_points** — high-yield one-line recall items. **Not** Question Bank MCQs (`questions` / `question_versions` stay 4–5 option scored items). Columns: `prompt`, `answer`, `explanation` (optional), `year_id`, `subject_id`, optional `chapter_id` / `topic_id`, `status` `draft|published`, entitlement columns, `sort_order`, `created_by`. Student catalog SELECT excludes `answer` / `explanation`. `open_pearl(id)` returns the reveal payload after `can_access_pearl`. `can_view_pearl` is published + active year enrollment + `account_allows_lms`. Content uses `resource_content_allowed` with kind `pearl_point` (grant overlay for this kind is not stored on `access_grants` yet).

## Import

**import_batches** — `created_by`, `filename`, `total_rows`, `inserted`, `skipped_duplicates`, `errors`.
**import_rows** — `batch_id`, `row_number`, `outcome check in ('inserted','skipped_duplicate','error')`, `error_message`, `question_id null`.

### Question Bank CSV schema (canonical)

Admin CSV/XLSX import (`/admin/questions/import`) and `import_question_batch` use these **exact** headers (lowercase). Do not invent alternate column names. Subject is chosen in the Admin UI (not a CSV column). Import status (`draft` / `review` / `approved`) is also UI-only.

| Column | Required | Notes |
|---|---|---|
| `question` | yes | Stem → `question_versions.stem` |
| `option_a` … `option_d` | yes | Options A–D |
| `option_e` | no | Required only when `correct=E` |
| `correct` | yes | `A`/`B`/`C`/`D`/`E` → `correct_key` |
| `explanation` | no | |
| `reference` | no | |
| `book` | yes | Matched case-insensitively under the chosen subject (optionally created) |
| `chapter` | yes | Under the resolved book |
| `topic` | yes | Under the resolved chapter |
| `difficulty` | no | `easy`/`medium`/`hard` (blank → `medium`) |
| `tags` | no | Pipe-separated (`\|`), not commas |

Client validation must pass before the RPC runs. The RPC is **atomic**: a hard error rolls back the whole call. Rows matching an existing `content_hash` are `skipped_duplicate` and **never overwrite** existing questions. Template + ChatGPT generation prompt live in Admin Import UI (`src/lib/questions/csv-import.ts`).

## Stats (Phase 10)

**question_stats** — `question_id`, `attempts_count`, `correct_count`, `p_value numeric`; refreshed by cron fn.
**test_stats** — `test_id`, registered/attempted/completed counts, avg/median/max/min.
