# Database Schema (canonical)

Conventions: every table has `id uuid primary key default gen_random_uuid()`, `tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger-maintained). RLS enabled on **every** table, deny-by-default. State columns are text enums via CHECK — never boolean flags.

## Identity

**profiles** — pk = Auth JWT `sub` (UUID). No foreign key to `auth.users` (required for a VPS `public` schema whose Auth lives in Cloud; `handle_new_user()` still runs when Auth and `public` share a database). `full_name`, `email`, `role text check (role in ('admin','student')) default 'student'`, `account_status text check in ('active','restricted','suspended','deactivated','revoked') default 'active'`, `is_main_admin boolean not null default false`, `active_session_id uuid`, `last_login_at timestamptz`.
- **Leaderboard projection fields (SPEC FREEZE):** dashboard Top 3 / analytics Top 20 display **name**, **college**, and **profile picture** alongside rank and Score. Authoritative college/avatar storage is `profiles.college_name` and `profiles.avatar_object_key` (private R2 key; signed/proxy URLs only — never a public payment/study-proof mix). `test_leaderboard_projection` reads these columns only. Do not expose private contact fields on leaderboards.
- Created by trigger `handle_new_user()` on `auth.users` insert when Auth is co-located, and/or by idempotent `ensure_profile()` from the authenticated JWT. Role always `'student'` on insert. `ensure_profile()` copies `full_name` and `college_name` from JWT `user_metadata` (heals blank `profiles.college_name` without overwriting a non-empty value) and never writes `role`, `is_main_admin`, or `account_status` on update (insert default `active`). Registration still accepts college in Auth metadata; provisioning promotes it into `profiles.college_name` for leaderboard use. On Auth/DB-split VPS hosts (no co-located `auth.users`), the SQL one-time backfill is a no-op — use `scripts/backfill-profile-college-from-auth.mjs` (dry-run default; `--apply` to write) so the dashboard Last-test board (`test_leaderboard_projection`) can show peer colleges.
- Triggers block student changes to `role`, `account_status`, and `is_main_admin`. Blocking `account_status` transitions must clear `active_session_id` (Layer 1 kick).
- At most one remaining Main Admin: the last `is_main_admin` row cannot be demoted/removed (RPC + constraint/trigger). The last **active** Main Admin cannot be blocked via `set_account_status`. First access-model migration: every existing `role = 'admin'` becomes Main Admin.
- Other admins: `role = 'admin'` plus `admin_permissions` rows **and** (SPEC FREEZE) assigned-class rows for limited admins. See [permissions.md](permissions.md).
- Dev/test accounts: use `node scripts/create-dev-account.mjs` (Auth Admin API, already-confirmed, no email round trip). PostgREST uses the new user's access token (and anon `list_years()`), never an opaque `sb_secret_*` Bearer. `ensure_profile()` creates the profile and **active** class enrollment. `--admin` calls `bootstrap_first_main_admin()` when no Main Admin exists. Not the real `/register` form — see docs/deployment.md "Auth emails" for why.

**permissions** — catalog of permission codes (`code text primary key`, label). Seeded; not edited by students.

**admin_permissions** — `admin_id` → `profiles`, `permission_code` → `permissions`. Unique `(admin_id, permission_code)`. RLS: no student access; writes only via `manage_admins` RPCs (`grant_admin_permission` / `revoke_admin_permission`). Main Admin is authorized even with zero rows (`has_permission` short-circuits). Promote/demote: `set_admin_role`, `set_main_admin` (last Main Admin cannot be removed).

**Assigned-class scope (SPEC FREEZE):** limited admins also require a **separate** admin↔year assignment relationship (`admin_year_assignments`). Unique `(admin_id, year_id)`. **Main Admin** sees all classes without assignment rows. Limited Admin authorization = **both** an assigned class **and** the relevant `admin_permissions` code. Permission codes remain independent of class scope. Cookie/UI year selectors are UX only and are not authorization. **Shipped** for curriculum/materials/MCQ and for subscription plans/subscriptions/applications (RLS + mutate RPCs use `admin_can_access_year` / `require_admin_year_scope`).

## Curriculum

**Class model (`years`):** `year_number` 1–5 unique, `name`. Existing years remain the class model — do **not** create a `classes` table. Canonical display names (SPEC FREEZE): 1st Year MBBS, 2nd Year MBBS, 3rd Year MBBS, 4th Year MBBS, **Final Year MBBS** (`year_number = 5`; existing “5th Year” / Year 5 may be displayed as Final Year MBBS rather than introducing a new class entity).

**Second level (`subjects`):** keep the table name `subjects` and denormalized `year_id` for join-free RLS. Do **not** invent a parallel `blocks` table.

**Authoritative Block / Final Year keys (`subjects.product_key`, SHIPPED):** student chrome uses only rows with non-null `product_key`:

| Year | `product_key` values | Canonical names |
|---|---|---|
| 1 | `block-1`…`block-3` | Block 1–3 |
| 2 | `block-4`…`block-6` | Block 4–6 |
| 3 | `block-7`…`block-9` | Block 7–9 |
| 4 | `block-10`…`block-12` | Block 10–12 |
| 5 | `medicine`,`surgery`,`gynecology`,`pediatrics` | Medicine, Surgery, Gynecology, Pediatrics |

Departmental subjects (Anatomy, …) remain with `product_key` NULL for Question Bank authoring taxonomy. Controlled insert/map migration does **not** destroy departmental UUIDs.

**Prof. Session (SHIPPED — subject-scoped IA):** `prof_session_days` belong to a product Block / Final-Year `subjects` row (`subject_id` required for live days; denormalized `year_id` always derived from the subject). Fixed `prof_session_day_slots`: `guidelines`, `los`, `one_liners`, `practice_mcqs`, `test_mcq`. Soft-delete → content Bin. Migration `20260922000005` **ensures** Final-Year product subjects (`medicine`,`surgery`,`gynecology`,`pediatrics`) before soft-deleting legacy year-level Days (never auto-maps those Days onto a clinical subject).

Block-level Prof. Session materials use `material_folders.content_surface = 'prof_session'` with `library_type` in (`syllabus`,`schedule`,`books`,`notes`,`lectures`,`ospe_past`,`ospe_lectures`,`ospe_material`). Day-scoped Guidelines/LoS folders set `prof_session_day_id` + `day_slot_key`. Practice MCQs: `prof_session_day_practice_questions` (references existing `questions` in the **same year** as the day — typically departmental Q-bank subjects, not the product Block row). Test MCQs: `tests.prof_session_day_id`. One-Liners: `one_liners.prof_session_day_id` (not Pearl Points).

Free students: locked empty Prof. Session in tree. Subscribed: published days + surface folders for enrolled year only.

**Content bin (SHIPPED):** soft-delete columns `deleted_at` / `purge_after` / `deleted_by` on academic content tables (including `mcq_bank_folders` / `mcq_bank_subfolders`); polymorphic bin RPCs; `purge_expired_bin_items` + `r2_purge_queue` for deferred R2 object deletion. Do not hard-delete immutable exam attempts, payments, or audit logs when content is purged.
- **Retention:** soft-delete sets `purge_after = deleted_at + 7 days`. `purge_after <= now()` is **eligibility**, not unconditional deletion (not worker runtime / `updated_at` / calendar guesswork). Manual Bin “Delete permanently” calls `purge_content` / `purge_content_batch` immediately. Recover clears the soft-delete trio and restores access.
- **Question ↔ test_questions retention (canonical):** the 7-day hard purge applies to a soft-deleted question **only when it has no `test_questions` rows**. Any question with a `test_questions` reference is **retained** (`question_referenced_by_test`) and is **not** an integrity failure merely because `purge_after` has passed — Bin / scheduler classify these as retained, not as purge failures. Published / closed / historical test references stay protected so frozen exam snapshots and attempt review remain intact. Draft-only references are **not** auto-detached: an administrator must deliberately remove the question from the draft test; once all `test_questions` references are gone, normal 7-day purge eligibility applies. Do **not** delete `test_questions` during question purge, and do **not** invent snapshot tables / FK redesign for this rule. Soft-deleted questions must not be newly published onto a test (`validate_test` / `publish_test` — see [test-rules.md](test-rules.md)).
- **R2 safety:** permanent purge deletes the DB row first, then `enqueue_r2_purge_if_unreferenced` only when no materials / OSPE / pearl / avatar / payment-proof row still references the key. Workers re-check refs before DELETE; missing object (404) is success.
- **Folder purge:** `material_folders.parent_id` and `materials.folder_id` are `ON DELETE CASCADE`. `purge_content` / `purge_expired_bin_items` therefore (1) purge overdue **materials first**, (2) refuse folder hard-delete while `folder_has_live_descendants` (any live child folder or material in the subtree), (3) capture `folder_subtree_r2_keys` before folder DELETE so nested soft-deleted material keys are still enqueued after CASCADE. A child material’s R2 key must never be lost merely because its parent folder was hard-deleted.
- **MCQ Bank folder purge:** `mcq_bank_subfolders.folder_id` is **not** `ON DELETE CASCADE` (NO ACTION). Manual/cron hard-delete of a soft-deleted `mcq_bank_folder` therefore (1) refuses while any **live** subfolder or live question remains in the subtree (`mcq_bank_folder_not_empty`), (2) hard-deletes remaining **soft-deleted** child subfolders first, (3) then deletes the folder. Soft-deleted questions stay as separate Bin rows (`ON DELETE SET NULL` placement FKs) and still honor `question_referenced_by_test`.
- **Access:** soft-deleted materials/OSPE are denied on `authorize_study_object` / `open_material` / `open_study_item` / `authorize_ospe_station_object` for **all** callers (including `manage_materials`).
- **List:** `list_content_bin_page(year_id, limit≤100, offset)` — server-side pagination with `total_count` (admin UI page size 50); question rows may surface `retain_reason = retained_referenced_by_test` when a `test_questions` reference blocks hard delete. Legacy `list_content_bin` remains for compatibility.
- **Single purge:** `purge_content(type, id)` — folder path uses the live-descendant guard + subtree R2 capture above; question path still raises `question_referenced_by_test` (unchanged guard).
- **Bulk purge:** `purge_content_batch(jsonb items)` — max **500** `{entity_type, entity_id}` per call; returns per-item `purged` / `blocked` / `already_gone` (retry-safe). App chunks larger selections. Question test-reference guard and R2 `enqueue_r2_purge` (unique open key) unchanged.
- **Scheduler log:** `purge_expired_bin_items` writes `purge_log.deleted_count` / `error_text` for real failures, and `retained_count` / `retained_text` for expected question reference retention (`question_referenced_by_test`) so retained rows are not mistaken for operational errors.
- **Question hard-delete:** `question_versions` remain append-only for normal writes (UPDATE always blocked). Security-definer `purge_content` / `purge_content_batch` set LOCAL GUC `medverse.allow_question_version_purge=1` so `forbid_version_mutation` allows DELETE only for that transaction; **normal FK CASCADE stays active** (`question_versions.question_id ON DELETE CASCADE`). Do **not** use `session_replication_role=replica` here — it disables FK cascades and orphans versions. Practice answers referencing those versions are cleared before the question delete (NO ACTION FK).

Hierarchy (unchanged table chain): `years` → `subjects` → `books` (subject_id, name, sort_order) → `chapters` (book_id, name, sort_order, **denormalized subject_id, year_id**) → `topics` (chapter_id, name, sort_order, **denormalized book_id, subject_id, year_id**).

`books` / `chapters` / `topics` remain **authoring taxonomy** for the Question Bank (CSV import), not student library folder trees. Sibling names are unique **case-insensitively** (`unique` indexes on `(parent_id, lower(name))`); CSV import lookup and create-missing reuse the same rule. First writer’s display casing is kept.

**Admin curriculum delete (SHIPPED):** `admin_delete_curriculum_node(kind, id)` — empty-node only (same protective pattern as empty MCQ Bank folder soft-delete). Refuses parents that still have taxonomy children, nodes that still have questions (including soft-deleted Bin rows — FK remains until `purge_content`), product subjects (`product_key` not null), and subjects still linked to tests / materials / MCQ folders / OSPE / Prof. Session / pearls / one-liners. Does **not** subtree-wipe and does **not** hard-delete questions via curriculum DELETE (that path hits immutable `question_versions`; questions leave via Content Bin + purge). Requires `manage_curriculum` + year scope.

Denormalized ids keep RLS join-free; maintained by trigger from the parent on insert/update.

## Question bank

**questions** — identity row (content lives in versions):
- `topic_id` + denormalized `chapter_id, book_id, subject_id, year_id`
- `current_version_id uuid` (fk question_versions, deferred)
- `status text check in ('draft','review','approved','needs_revision','archived') default 'approved'` — **admin-managed content (no approval gate):** create/import coerce to `approved` immediately. Legacy values `draft`/`review`/`needs_revision` remain in the CHECK for backward compatibility but do not gate availability after the one-time conversion migration. `archived` still excludes from practice/tests. Soft-delete (`deleted_at`) is the Bin lifecycle, not status.
- `difficulty text check in ('easy','medium','hard')`
- `tags text[]`, `content_hash text` (unique — normalized md5 of stem+options+correct), `stem_normalized text` (trigram index)
- `used_in_test boolean default false` — **derived UI cache ONLY.** Authoritative truth = existence of a published `test_questions` row. Never use for security, eligibility, or historical truth. May be refreshed from test_questions at any time.
- `mcq_bank_subfolder_id uuid null` → `mcq_bank_subfolders` — **canonical Academic MCQ Bank placement** (zero or one subfolder). Does **not** replace Question Bank taxonomy (`subject_id` remains departmental). NULL = unassigned (or legacy). Setting subfolder→different subfolder via raw UPDATE is blocked; use assign/remove/bulk-move/create/import RPCs. Independent of Prof. Session day junctions and `test_questions`.
- `mcq_bank_folder_id uuid null` → `mcq_bank_folders` — **denormalized parent** of the subfolder (trigger-synced when `mcq_bank_subfolder_id` is set; cleared on unassign). Legacy rows may still have `mcq_bank_folder_id` with NULL `mcq_bank_subfolder_id` (pre-subfolder direct placement); those are **excluded** from Folder/Bank performance aggregates and must not be silently merged or deleted. New create/import must set a subfolder (never folder-only).
- `created_by uuid`

**mcq_bank_folders** (SHIPPED) — admin-managed folders under Academic product subjects (Blocks / Final Year clinical). **Not nested among themselves.** Container of **subfolders** + PDF store. Not a second Question Bank.
- `academic_product_subject_id` → `subjects` row with non-null `product_key`; denormalized `year_id` (trigger-maintained)
- `name`, `sort_order`, `created_by`, soft-delete trio (`deleted_at` / `purge_after` / `deleted_by`) → Content Bin entity `mcq_bank_folder`
- `material_folder_id` → private `material_folders` row with `library_type = 'mcq_bank'` (PDF store for this folder; not a student library nav). Created/synced by `ensure_mcq_bank_material_folder` on create/rename; soft-deleted with the folder when empty
- Soft-delete (**Main Admin only**): cascade in one transaction — live child subfolders, their live MCQs, live materials on the linked `mcq_bank` material folder, and the shadow material folder — all share the same `deleted_at` for hierarchy restore. Ordinary admins cannot soft-delete or restore folders. Admin list returns `question_count` (sum of live approved MCQs in child subfolders only — excludes legacy folder-only attachments) + `pdf_count` + subfolder counts as needed.
- PDF upload: `allocate_study_object_key(p_folder_id)` — null folder still requires `manage_materials`; with an `mcq_bank` material folder, `edit_questions` + assigned-class year may allocate (`can_admin_manage_mcq_bank_material_folder`). Does not open general materials admin.
- Product model: admin creates named folders under a product subject; **MCQs are imported/created into subfolders**, not directly into folders. Historical migration seed of a renameable “Source MCQ Folder” name (fresh empty DBs only) is ordinary folder data — not required, not recreated on clean baselines.
- Student path: MCQ Bank → Folder hub (PDFs + subfolder list + **aggregate** progress) → Subfolder (practice unit) → `get_practice_batch('mcq_bank_subfolder' | '_favorites' | '_incorrect', subfolder_id)` gated by `can_access_mcq_bank_subfolder_practice` → `can_access_mcq_bank_folder_practice` → enrollment + `has_practice_access(academic_product_subject_id)`. Folder-scope practice/progress RPCs aggregate **all live subfolders** of that folder (never legacy direct folder MCQs). PDF open uses existing `authorize_study_object` / reader.
- CSV: `import_question_batch(..., p_mcq_bank_subfolder_id)` places new/unassigned questions in the open **subfolder**; book/chapter/topic remain Question Bank taxonomy. Duplicates are `skipped_duplicate`; an existing question already in another subfolder/folder is never silently reassigned. Folder-only import is rejected.
- Admin RPCs: folder create/rename/reorder; **Main Admin** cascade soft-delete/restore; **subfolder** create/rename/reorder; **Main Admin** cascade soft-delete/restore; list subfolder questions; `admin_assign_unassigned_question_to_subfolder` (NULL→subfolder only); `admin_remove_question_from_mcq_bank_subfolder`; **`admin_bulk_move_mcq_bank_subfolder_questions`** / **`admin_bulk_move_mcq_bank_folder_questions`** (atomic via NULL then dest; max 2000; same-year only); **`admin_bulk_soft_delete_subfolder_questions`** / **`admin_bulk_soft_delete_folder_questions`** (any admin with `edit_questions` + year scope); **`admin_bulk_restore_subfolder_questions`** / **`admin_bulk_restore_folder_questions`**; `list_question_usages` for delete warnings
- Delete semantics (do not collapse): **Remove from subfolder** = unassign (`mcq_bank_subfolder_id` + denormalized `mcq_bank_folder_id` NULL, question stays in Question Bank); **Move to Bin / Delete MCQ** = soft-delete (`deleted_at` / Content Bin) — any admin with `edit_questions`; **folder/subfolder Bin** = Main Admin cascade; **permanent purge** = Content Bin purge path only
- Hierarchy restore lineage: children soft-deleted in the same cascade share the parent’s `deleted_at` (set with `clock_timestamp()` so independent bins in the same transaction do not collide). Restore restores only those matching-timestamp children (not independently binned MCQs). Subfolder restore still requires a live parent folder.

**mcq_bank_subfolders** (SHIPPED) — manually managed practice containers under a folder.
- `folder_id` → live `mcq_bank_folders`; denormalized `year_id` + `academic_product_subject_id` from parent (trigger-maintained; cross-year/cross-folder attachment forbidden)
- `name`, `sort_order`, `created_by`, soft-delete trio → Content Bin entity `mcq_bank_subfolder`
- Empty subfolders allowed. Soft-delete (**Main Admin only**) cascades to live MCQs in that subfolder (same `deleted_at` lineage). Ordinary admins cannot soft-delete or restore subfolders.
- Sibling naming follows the same nonempty-trim rules as folders (no extra uniqueness constraint unless folders already had one).
- Performance: **subfolder** = its direct MCQ set; **folder** = aggregate of all child subfolders; **MCQ Bank** (product subject) = aggregate of all folders’ subfolders. Prefer server-side aggregation of `practice_progress` over duplicated parent progress rows.

Workflow (**admin-managed, no approval step**): create/import → `approved` immediately (usable in practice/tests). `archived` still excludes from practice/tests. Legacy status labels `draft`/`review`/`needs_revision` are inert compatibility values; a one-time migration converts live `draft`/`review` rows to `approved`. Soft-delete/Bin is separate from status.

Status transitions remain enforced at the database level for legacy/compat paths (`protect_question_status_transition()` trigger, `before update of status`, `20260913000005_question_status_transition_guard.sql`). The graph is unchanged for rows that still move between legacy labels: `draft → {review, approved, archived}`, `review → {approved, needs_revision, draft, archived}`, `approved → {needs_revision, archived}`, `needs_revision → {review, approved, archived}`, `archived → {draft}`. Product UI no longer offers an approval workflow.

**question_versions** — **immutable, append-only**:
- `question_id`, `version_no int` (unique per question), `stem text`, `options jsonb` (array of `{key:'A'..'E', text}` — 4 or 5 entries), `correct_key char(1)`, `explanation text`, `reference text`
- UPDATE/DELETE blocked by trigger (raises) AND absent RLS policies.
- Editing a question = `create_question_version(question_id, ...)` fn: inserts version_no = max+1, updates `questions.current_version_id`, `content_hash`, `stem_normalized` atomically.

`correct_key`/`explanation` must never reach a student before they answer: exam questions served via RPC that omits them; practice answers checked server-side by RPC.

## Enrollment (class assignment — not subscription, not LMS approval)

**enrollments** — `student_id`, `year_id`, `status check in ('active','expired')`, `approved_by`, `approved_at`, `expires_at`.
- This row is the student’s **assigned MBBS year / class**. It is not payment and not “admin approved to enter the LMS.”
- Partial unique index: `(student_id) WHERE status = 'active'` — one live class.
- After email verification, `ensure_profile()` / `handle_new_user()` insert `status = 'active'` when `user_metadata.year_id` names a real year and the student has **never** had any enrollment row (first provision only). Students have no direct INSERT/UPDATE/DELETE on the table; class changes go through documented RPCs.
- **Class-change product law (SPEC FREEZE):**
  - **Free** student (no live subscription and no pending subscription application): may change class **freely** (self-serve RPC; still one live enrollment).
  - **Pending** subscription application: class is **locked** while the application is pending.
  - **Live / active** subscription: class is **locked** to `subscriptions.year_id` (purchased class). Further change only via admin-mediated paths below, which must keep subscription class in sync.
- `promote_student(student_id)`: sets active row `expired`, inserts active row for year+1. Audit-logged. Requires `manage_year_changes`. When a live subscription exists, keep `subscriptions.year_id` and `subscriptions.plan_id` aligned with the new enrollment (remap `plan_id` to an active destination-year plan; preserve `starts_at`/`ends_at`). Fail with `destination_plan_unavailable` before mutating enrollment if no active destination plan exists.
- **Migration:** existing `status = 'pending'` rows are **auto-activated**. Enrollment `pending` is not used going forward. Pre-existing `suspended`/`revoked` enrollment rows: mapping onto `profiles.account_status` is a **pending owner decision**.

**year_change_requests** — `student_id`, `from_year_id`, `to_year_id` (any year), `status check in ('pending','approved','rejected')`, `reason text`, `reviewed_by`, `reviewed_at`, `review_note text`.
- Partial unique: `(student_id) WHERE status = 'pending'`.
- **Product role (SPEC FREEZE):** used for **subscribed** (class-locked) students who need an admin-approved class change — not the free-student self-serve path. Student creates/updates only own `pending` row via RPC (`create_year_change_request` / `update_pending_year_change_request`). Requires `account_allows_lms()`.
- Approve (`manage_year_changes`): expire current live enrollment, insert `active` for `to_year_id`, audit; keep live `subscriptions.year_id` and `subscriptions.plan_id` in sync with the new class (remap `plan_id` to an active destination-year plan preferring the same `is_complimentary`, then `sort_order`/`name`; preserve `starts_at`/`ends_at`). Fail with `destination_plan_unavailable` before mutating enrollment if no active destination plan exists. Does **not** change `profiles.account_status`.
- Reject (`manage_year_changes`): terminal for that row; student may submit a new request.

## Subscriptions & applications

**subscription_plans** — `name`, `description`, `duration_days int`, `is_complimentary boolean not null default false`, `is_active boolean not null default true`, sort order, **`year_id` (required; class-scoped)**, **`price` (advertised PKR display; not the application amount)**.
- Schema supports multiple plans per class. Complimentary access is a plan (and/or grants), **not** a flag on `profiles`. Students SELECT only active plans for their enrolled year(s).

**subscriptions** — `student_id`, `plan_id`, `status check in ('active','expired','deactivated')`, `starts_at timestamptz not null`, `ends_at timestamptz not null`, `grace_days int not null default 0 check (grace_days in (0,1,2))`, `paid_access_mode text not null default 'all_entitled' check in ('all_entitled','grants_only')`, `application_id uuid null`, `activated_by`, `activated_at`, `deactivated_by`, `deactivated_at`.
- **Purchased class (SPEC FREEZE):** `year_id` (FK → `years`) stores the class locked for the live subscription. Live access locks the student’s enrollment to this class. **Not yet necessarily present in every deployed schema** — additive column + backfill are a future migration dependency; product law is frozen here.
- CHECK `starts_at < ends_at`. Partial unique `(student_id) WHERE status = 'active'`. Index `(ends_at) WHERE status = 'active'`.
- Live entitlement: `status = 'active' AND now() < ends_at + grace_days` (server clock). `expire_due_subscriptions()` sets `expired` when `now() >= ends_at + grace_days`. Access helpers do **not** wait for that UPDATE.
- Renewal while still live (including grace): **update the existing active row** `ends_at := ends_at + duration` (from **existing end**, not `now()`). Do not insert a second active row. New period when none live: insert a new `active` row with `starts_at = now()`, `ends_at` from duration or admin dates; previous expired/deactivated rows remain history. Admin mutations write `audit_logs`.
- `paid_access_mode = grants_only`: paid (`any_subscription` / `plan`) resources require a live grant; free entitlement still applies. `all_entitled` is the default overlay.
- Students SELECT own rows only. Writes via admin RPCs (`manage_subscriptions`). `assign_subscription_plan` may only assign an active plan whose `year_id` equals the subscription’s `year_id` (`plan_year_mismatch` otherwise).

**subscription_applications** — `student_id`, `plan_id` (**required** on create/update via RPC — student must select an active class-scoped plan; no single-global-plan auto-resolve), `amount numeric not null check (amount > 0)` (student-submitted / reviewed transfer amount — **not** silently replaced by `subscription_plans.price`), `currency text not null default 'PKR'`, `screenshot_object_key text not null`, `status check in ('pending','approved','rejected','cancelled')`, `reviewed_by`, `reviewed_at`, `review_note`.
- **Selected purchase class (SPEC FREEZE):** `year_id` (FK → `years`) stored at application submit. While `pending`, that class lock applies to the student. On **approve**, the purchased class is copied onto `subscriptions.year_id` (and enrollment aligned). Additive column is a future migration dependency; product law is frozen here.
- **Plan binding:** `create_subscription_application` / `update_pending_subscription_application` require a valid active `plan_id` with `plan.year_id = application.year_id`, and the student must have an active enrollment in that year. Cross-year / inactive / unenrolled bindings raise (`plan_required` / `plan_not_found` / `plan_inactive` / `plan_year_mismatch` / `year_access_denied`).
- Partial unique `(student_id) WHERE status = 'pending'` — no simultaneous pending applications.
- While `pending`, the student may edit/resubmit **that row** (amount, screenshot, plan) via RPC.
- `approved` is terminal and creates/activates/extends a subscription. `rejected` is terminal; student may insert a **new** application.
- Screenshot bytes live in **private Cloudflare R2**; the table stores only the object key (`payment-proofs/{tenant_id}/{student_id}/{uuid}`). Never a public URL. **Canonical object is optimized WebP** produced server-side on upload (JPEG/PNG/WebP input → metadata-stripped WebP; original upload bytes are not retained). Admin review uses authenticated same-origin proxy `GET /api/payment-proofs/[applicationId]` after `authorize_payment_screenshot_access` (`review_subscription_applications`) — no browser-visible signed R2 URL. On **replace**, the previous object is deleted after a successful update. On **reject**, the object is deleted after a successful reject (row may keep the key for audit metadata; bytes are removed). When the **linked subscription ends** (natural expiry after grace via `expire_due_subscriptions`, or immediate admin `deactivate_subscription` / `set_subscription_end` → expired), `release_subscription_payment_proof` clears `screenshot_object_key` and enqueues the key on `r2_purge_queue` only when unreferenced. Application and subscription history rows are preserved. Failed attach after upload discards the new object only when `authorize_payment_screenshot_discard` allows it (orphan keys; never a key still attached to any application status).
- Currency default is **PKR** (owner decision). Copied from `payment_settings.currency` when the student omits it.
- No payment gateway. Admin decides whether `amount` is acceptable.

**payment_settings** — one row per tenant: `bank_name`, `account_title`, `account_number`, `iban`, `payment_instructions`, `qr_reference`, `currency text not null default 'PKR'`, `is_active`, `subscription_grace_days int not null default 0 check in (0,1,2)`. Configured by `manage_payment_settings`. Active accounts read the **active** copy via `get_payment_instructions()` (`account_allows_lms()`). Restricted/suspended/deactivated/revoked callers are rejected. Not hardcoded. Subscription expiry is independent of this gate. Tenant grace is the default copied onto new subscription rows.

## Resource entitlement, grants, restrictions

Each student-facing resource kind carries the same entitlement shape (columns on the resource row **or** a side table with unique resource key — implementation may choose one layout; semantics are identical):

- `entitlement text check in ('free','any_subscription','plan')` default `'free'`
- `required_plan_id uuid null references subscription_plans` — required iff `entitlement = 'plan'`.

Applies to **tests**, **material_folders**, **practice subjects** (`subjects`), **pearl_points**, and **ospe_stations**. Main Admin configures each practice subject independently. Do not hard-code practice, pearls, or OSPE stations as always free or always paid. PDF files and text guidelines inherit **folder** entitlement — they are not a second policy. OSPE Practice stations carry their own entitlement columns (independent of `material_folders` and of `has_practice_access`).

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

**tests** — `title`, `year_id`, `subject_id null`, `status text check in ('draft','published','closed','archived','invalidated') default 'draft'`, `opens_at`, `closes_at`, `duration_minutes int`, `marks_per_question numeric(6,2) default 1`, `negative_mark numeric(4,2) default 0`, `shuffle_questions bool default true`, `shuffle_options bool default false`, `show_review text check in ('after_submit','after_close','never') default 'after_close'`, `min_questions int default 1`, `max_attempts int not null default 1 check (max_attempts >= 1)` (counted attempts per student; frozen after publish; [test-rules.md](test-rules.md)), optional `syllabus text` (plain text, `char_length ≤ 8000`, frozen after publish like other config), `created_by`, plus entitlement columns (`free` / `any_subscription` / `plan`; existing rows backfilled `free`).
("live" is derived: `status='published' and now() between opens_at and closes_at` — not a stored state.)
Student-facing **Free / Both / Paid / Neither** audience in the test form maps onto these entitlement columns (not a new enum): Free and Both → `free` (subscription never removes free access; Both is the same access law as Free); Paid only → `any_subscription`; Neither → remain `draft` (unpublished tests are never in the student catalog). `test_audiences` remains year-cohort catalog membership.
Draft hard-delete: `delete_draft_test(p_test_id)` (`publish_tests`, draft-only, audit `test_draft_deleted`). Admin table DELETE is also restricted to `status='draft'`. No `deleted_at` on tests — not a Content Bin entity. Lifecycle helpers: `return_to_draft_test` (unopened published, zero attempts) and `reuse_test_as_draft` (conducted → new draft); see [test-rules.md](test-rules.md).

**test_prep_guidelines** — `test_id` PK → `tests` (`ON DELETE CASCADE`), `body_text`. Optional preparation / study notes for a test. No student table SELECT (`get_test_prep_guidelines` / `accessible_test_prep` after `can_access_test`). Writes allowed only while the test is `draft` (frozen after publish, same idea as `protect_published_test`). History keeps the row attached after submit/close; body still requires live content entitlement.
- `rank_dirty_at timestamptz` — leftover coalesced-ranking drain source for older writers. New scoring must **not** `UPDATE` this column; `rank_dirty_tests()` still clears it when set.

**rank_dirty_queue** — append-only dirty signal that a test's `rank`/`percentile` needs recomputation. `test_id` → `tests` (`ON DELETE CASCADE`). `score_attempt` inserts one row; `rank_dirty_tests()` distinct-drains then calls `rank_test` once per test. No student/admin table access (SECURITY DEFINER RPCs only). Concurrent same-test submits must not serialize on the `tests` row for this signal ([scoring-rules.md](scoring-rules.md)).

**test_questions** — `test_id`, `question_id`, `question_version_id` (**frozen at publish**), `position int`, `marks numeric null` (override), `voided bool default false`, `void_policy text check in ('exclude','credit_all') null`. Unique (test_id, question_id). Immutable after publish except `voided`/`void_policy` (trigger-enforced).

## Attempts

**test_attempts** —
- `test_id`, `student_id`, `state text check in ('in_progress','submitted','invalidated')`
- **Partial unique index `(test_id, student_id) WHERE state = 'in_progress'`** — at most one live attempt per student per test. The **attempt limit** is not an index: `start_attempt` checks counted attempts (`in_progress` + `submitted`) `< tests.max_attempts` under the new-start `tests … FOR UPDATE` lock. Invalidated attempts never count; all history preserved; controlled retake (admin invalidate) unchanged. Multiple `submitted` rows per (test, student) are allowed only up to `max_attempts`.
- `started_at` (server), `expires_at` (server: `least(started_at + duration, closes_at)`), `submitted_at`, `submit_source check in ('student','auto','admin')`
- `device_id uuid not null`, `session_id uuid` (auth session that started it)
- `question_order uuid[]` (shuffled question_version_ids, persisted at start), `option_orders jsonb null`
- `invalidated_reason text`, `invalidated_by uuid` (both required when state='invalidated')
- results: `score numeric`, `raw_correct int`, `raw_wrong int`, `raw_blank int`, `percentage numeric`, `rank int`, `percentile numeric`. `rank`/`percentile` are set only on each student’s **ranked** (best submitted) attempt; other submitted attempts store null ([test-rules.md](test-rules.md)).
- Indexes: (test_id, state), (student_id), partial (state) where in_progress, (test_id, score desc), (test_id, student_id).
- Students have NO direct UPDATE — RPC only.
- Own historical **result summary** is `get_own_test_result(p_test_id)` (SECURITY DEFINER, `auth.uid()` + `state = 'submitted'`): the ranked attempt plus the caller’s own attempt history for that test. It is not catalog `can_view_test`. Review items stay on `get_attempt_review` (owner requires `account_allows_lms()`; blocked accounts cannot read review; permissioned admins retain access).

**attempt_answers** — `attempt_id`, `question_version_id`, `selected_key char(1) null` (null = cleared), `marked_for_review bool default false`, `answered_at`, `time_spent_ms int`, `save_seq bigint`. **Unique (attempt_id, question_version_id)** → autosave = upsert with `save_seq` monotonic guard.

## Practice

**subjects** carry the same entitlement columns as tests/folders (Main Admin configures each subject/Block; existing subjects backfilled `free`).
**practice_progress** — Done/Favorites/Incorrect cursor keyed by `(student_id, item_kind, item_id)`. Column `marked` is the canonical **Favorites** flag (product: Favorite / Unfavorite); column `incorrect` is the canonical **Incorrect** cursor (set by `submit_practice_answer`: wrong → true, correct → false). Both are independent of `state` (`remaining`|`done`), of each other, of `practice_answers`, `practice_seen`, and session history. For MCQs (`item_kind = question`), denormalized `subject_id` is always **`questions.subject_id`** (departmental Question Bank taxonomy) — not `mcq_bank_folders.academic_product_subject_id`. `get_practice_batch` returns that same `subject_id` so practice can hydrate via `get_practice_progress` without a student `questions` SELECT. Entitlement remains on the product subject; progress identity stays departmental so Question Bank and MCQ Bank practice share one progress row per question.
- **Practice unit:** the **subfolder**. Scopes: `mcq_bank_subfolder`, `mcq_bank_subfolder_favorites`, `mcq_bank_subfolder_incorrect`. Folder scopes (`mcq_bank_folder*`) remain as **aggregates across all live child subfolders** (exclude legacy folder-only MCQs).
- **Progress RPCs:** `get_mcq_bank_subfolder_practice_progress(subfolder_id)`; `get_mcq_bank_folder_practice_progress(folder_id)` / `list_mcq_bank_folder_practice_progress(product_subject_id)` aggregate child subfolders; optional product/bank aggregate sums the same. Metrics: caller-scoped `done` / `total` / `remaining` / `percent_complete` / `complete` (+ `favorites` / `incorrect` where the UI exposes them) from approved live questions in scope + the caller’s `practice_progress` — not a second progress system and not cached parent counters.
- **Undone-first:** for normal subfolder (and folder-aggregate) scopes, `get_practice_batch` serves only questions with no progress row or `state = remaining`, ordered by `practice_seen.cycle` then `random()`. When 100% done, the batch is empty (no silent re-round).
- **Favorites / Incorrect practice:** favorited (`marked = true`) or incorrect (`incorrect = true`) approved questions **in that authorized subfolder** (or folder aggregate). Empty when none. Unfavoriting / answering correctly clears from the set without resetting Done or deleting answers independently of normal Done writes.
- **Favorites / Incorrect are not entitlement:** every Favorites/Incorrect read/practice/listing path MUST re-check `can_access_mcq_bank_subfolder_practice` / `can_access_mcq_bank_folder_practice` — active enrollment on folder `year_id` **and** `has_practice_access(academic_product_subject_id)`. Never “IDs → SELECT questions” without those gates. Expired / wrong-class / unauthorized callers get `practice_access_denied` (no stems).
- **Explicit Restart:** `reset_mcq_bank_subfolder_practice(subfolder_id)` / `reset_mcq_bank_folder_practice(folder_id)` set `done → remaining` for the caller’s questions **in that scope only**. Preserves `marked`, `incorrect`, `practice_answers`, `practice_seen`, and session history.

**practice_seen** — `student_id`, `question_id`, `cycle int default 1`, `last_seen_at`. Unique (student_id, question_id). Current “served / cycle” cursor — **not** the frozen Done/Favorites/Incorrect product model.
**practice_answers** — `student_id`, `question_version_id`, `selected_key`, `is_correct bool`, `answered_at`, denormalized `subject_id, chapter_id, topic_id`. Append-only accuracy/history log. Resetting Done must **not** delete this history. Incorrect cursor is maintained on `practice_progress.incorrect` by `submit_practice_answer`, not by deleting answer history.
Practice list RPCs return catalog rows with a lock flag; start/fetch RPCs enforce entitlement (deny > grant > plan/subscription > free).

**Practice product law (SPEC FREEZE)** — separate from formal exams; **never** reuse `test_attempts`:
- Filters / states: **All / Remaining / Done / Favorites** (`marked` column); Incorrect set via `incorrect` column + Practice Incorrect mode
- Favorite / Unfavorite (`set_practice_item_marked`)
- Incorrect set maintained by `submit_practice_answer`
- Done → Remaining reset
- Percentage completion
- Forward practice timer
- Practice report
- Honest persistence requires a dedicated practice-progress (and optionally practice-session summary) shape in a **future** migration — do not overload `practice_seen.cycle` as Done, and do not invent exam attempt states for practice.

**Flashcards (SPEC FREEZE):** category **placeholder only**. No flashcard engine table and no card content rows in this freeze.

## Materials

**material_folders** — `name`, optional `description` (used by Other Services / Career Counseling Series blurbs; nullable elsewhere), `year_id` (required for all library types **except** `career_counseling_series`, where `year_id` **must be null** — universal hub), `subject_id null`, `sort_order`, `parent_id` (nullable, same-year cycle-guarded nesting; CCS forbids nesting — `parent_id` null; **one_liner** also forbids nesting), `library_type` in (`guidelines`,`los`,`ospe_material`,`ospe_lectures`,`ospe_past`,`books`,`notes`,`lectures`,`syllabus`,`schedule`,`past_papers`,`flashcards`,`other_services`,`career_counseling_series`,`mcq_bank`,`one_liner`), `content_surface` `academic|prof_session` (default `academic`), optional `prof_session_day_id` + `day_slot_key` for day-scoped Guidelines/LoS. Plus entitlement columns. **`mcq_bank`** is the private PDF store linked from `mcq_bank_folders.material_folder_id` — not a separate student library category. **`one_liner`** is the Academic Block chrome One Liner PDF folder type (requires `subject_id`). **Notes remains its own storage `library_type`**. Student Academic Block / Final Year subject chrome includes Notes, Syllabus, and One Liner when `content_surface = 'academic'` (folder `subject_id` scoped to the product subject). Prof. Session Block chrome includes Notes (and Syllabus) when `content_surface = 'prof_session'`. Do not mix the two surfaces in one folder row. **Past Papers** (`past_papers`), **Other Services** (`other_services`), and **Career Counseling Series** (`career_counseling_series`) are top-level shell hubs — not Block chrome categories — see [architecture.md](architecture.md) §2b-ii / §2b-iii / §2b-iv. Career Counseling Series is **universal** (not year/enrollment-scoped) and is **not** an Other Services folder. Delivery `materials.kind` is **not** that category. Flashcards stays empty/placeholder with no card table.

**materials** — `folder_id`, `title`, `description`, `file_type text`, `kind text check in ('drive','pdf','guideline') default 'drive'`, `status text check in ('draft','published') default 'published'` (existing Drive rows backfilled published), optional `chapter_id` / `topic_id` / `reference_text`, plus kind-specific payload:
- `drive` — `drive_url` https-only (YouTube or Google Drive / other https). No R2 key / body. Students open via `open_material` (never catalog SELECT of the URL).
- `pdf` — private R2 `r2_object_key` under `study-content/`; optional `cover_object_key`; no Drive URL / body.
- `guideline` — `body_text` (markdown/plain); no Drive URL / PDF object.

**Two student surfaces, one store (SPEC FREEZE):** **Resources** (free-student label) lists only curated Admin-unlocked / `entitlement = 'free'` items and/or unrevoked personal grants (not restricted) on the **same academic tree** — never paid-only items that a subscriber can open merely via live subscription, and never duplicate educational rows. The **full library** remains a separate subscribed surface over the same rows. Do not duplicate educational rows to mark free vs paid — use entitlement columns (and grants/restrictions).

**Search (SPEC FREEZE):** folder / subfolder / tree **names** only (class, Block/`subjects`, folder, and any future day/container names). No stem/PDF/video full-text index in this freeze.

Student catalog SELECT must **not** expose `drive_url`, `body_text`, or R2 keys. Table-level `SELECT` is revoked and re-granted on metadata columns only. Students see **published** items in folders they `can_view`. `open_material(id)` returns a Drive URL only for `kind = 'drive'` after student entitlement or `manage_materials`. `open_study_item(id)` returns guideline body (or PDF catalog metadata without the object key) after the same folder content check. `authorize_study_object(id)` returns the R2 key for Next.js to sign; students must not obtain PDF bytes without that path.

## PDF reader highlights

**pdf_highlights** — private per-student text highlights on a PDF `materials` row. Columns: `student_id`, `material_id`, `page_number`, `rects` (JSON array of `{x1,y1,x2,y2}` in **PDF user space** — stable across zoom/rotation), `selected_text` (≤4000), `color`. RLS: own-row SELECT/INSERT/UPDATE/DELETE; INSERT/UPDATE also require `can_annotate_pdf(material_id)` (published live PDF + `can_access_material_folder`, or `manage_materials`). Not visible to other students. Do not store highlights only in browser storage.

**pdf_reading_progress** — private per-student last-read page on a PDF `materials` row. Columns: `student_id`, `material_id`, `page_number` (≥1), unique `(student_id, material_id)`. Not an event log — client debounced upserts only. RLS: own-row SELECT/INSERT/UPDATE/DELETE; INSERT/UPDATE require `can_annotate_pdf(material_id)` (same entitlement gate as highlights). Browser localStorage may cache optimistically; the server row is authoritative when available.

## One Liner (canonical student surface)

**Product model:** One Liner → admin-created **Folder** → PDF document(s) → MedVerse PDF reader + `pdf_highlights`.

**Store:** `material_folders` with `library_type = 'one_liner'` + `materials.kind = 'pdf'` (same R2 `study-content/` path, `authorize_study_object`, `/api/study-content/[id]`, and highlights as Notes/Syllabus). Folders require `year_id`, `subject_id` (Block / Final Year product subject), `content_surface = 'academic'`, and `parent_id` null (no nested folders in this phase). Folder entitlement via existing `materials_folder` columns / `set_resource_entitlement`; PDFs inherit folder entitlement.

**Legacy (retained, not student chrome):** `pearl_points` Q&A rows + optional item PDF (`authorize_pearl_object` / `/api/pearls/[id]`) remain in schema for admin archive / Content Bin. Do **not** present Pearl Points as a parallel student category. Do **not** blindly migrate Q&A rows into PDF folders.

**Prof. Session day One-Liners** remain on table `one_liners` (day-scoped title/body + **optional** private source PDF; no Block chrome duplicate). Optional PDF uses the same `study-content/` R2 family as pearls (`r2_object_key` / `r2_content_type` / `r2_byte_size`, generated `has_source_pdf`), `authorize_one_liner_object(id)`, and Next.js private stream `/api/one-liners/[id]`. Student PDF authorize requires **active class enrollment for the row’s year and a live subscription** (`has_live_subscription()`), matching architecture.md §2c (entire Prof. Session surface subscription-locked). Student catalog SELECT grants exclude R2 key columns (flag only). Do not drop or silently merge into `pearl_points` or into `library_type = 'one_liner'` folders.

## Pearl points (legacy name)

Legacy Q&A store for the former One Liner product — table `pearl_points`. Student Block chrome now uses **One Liner** PDF folders above.

## OSPE Practice stations

**ospe_stations** — image + hidden-answer Practice stations. **Not** library OSPE packs (`material_folders.library_type` `ospe_material` / `ospe_lectures`), **not** MCQs, **not** `test_attempts`. Columns: `title`, `answer`, `year_id`, `subject_id`, `status` `draft|published`, entitlement columns (`free` / `any_subscription` / `plan`), private R2 `r2_object_key` under `study-content/` with `r2_content_type` `image/jpeg|image/png|image/webp` and `r2_byte_size > 0`, `sort_order`, `created_by`. No `chapter_id` / `topic_id` / `explanation` / `description` / `folder_id` / Drive or guideline payload. Student catalog SELECT is metadata only (no `answer`, no R2 columns, no `created_by`). `can_view_ospe_station` = published + active year enrollment + `account_allows_lms`. `can_access_ospe_station` adds `resource_content_allowed('ospe_station', …)` — **do not** use `has_practice_access`. Image bytes: `authorize_ospe_station_object(id)` returns the key only (admin `manage_materials` + assigned class may authorize draft; student needs published + content entitlement). Reveal: `open_ospe_station(id)` returns `{id,title,answer}` only. Admin edit: `get_ospe_station_for_admin` (`manage_materials` + `admin_can_access_year`). Entitlement writes via `set_resource_entitlement(..., 'ospe_station', ...)`. Practice progress `item_kind` includes `ospe`, authorized through `can_access_ospe_station`. Reuse `allocate_study_object_key` / `authorize_study_object_discard`. Per-student OSPE grant overlay deferred (same as pearls).

## Import

**import_batches** — `created_by`, `filename`, `total_rows`, `inserted`, `skipped_duplicates`, `errors`.
**import_rows** — `batch_id`, `row_number`, `outcome check in ('inserted','skipped_duplicate','error')`, `error_message`, `question_id null`.

### Question Bank CSV schema (canonical)

Admin CSV/XLSX import (`/admin/questions/import`) and `import_question_batch` use these **exact** headers (lowercase). Do not invent alternate column names. Subject is chosen in the Admin UI (not a CSV column). Import always creates **`approved`** questions (no approval step; any legacy status column in the UI is ignored).

| Column | Required | Notes |
|---|---|---|
| `question` | yes | Stem → `question_versions.stem` |
| `option_a` … `option_d` | yes | Options A–D |
| `option_e` | no | Required only when `correct=E` |
| `correct` | yes | `A`/`B`/`C`/`D`/`E` → `correct_key` |
| `explanation` | no | |
| `reference` | no | |
| `book` | yes | Matched case-insensitively under the chosen subject (optionally created); uniqueness is `(subject_id, lower(name))` |
| `chapter` | yes | Matched case-insensitively under the resolved book; uniqueness is `(book_id, lower(name))` |
| `topic` | yes | Matched case-insensitively under the resolved chapter; uniqueness is `(chapter_id, lower(name))` |
| `difficulty` | no | `easy`/`medium`/`hard` (blank → `medium`) |
| `tags` | no | Pipe-separated (`\|`), not commas |

Client validation must pass before the RPC runs. The RPC is **atomic**: a hard error rolls back the whole call. Rows matching an existing `content_hash` are `skipped_duplicate` and **never overwrite** existing questions. Concurrent imports that race on the same missing book/chapter/topic (including case variants) reuse the winner’s taxonomy row (`ON CONFLICT (parent, lower(name))` + re-select); a concurrent `content_hash` unique race is recorded as `skipped_duplicate` rather than aborting the batch. Template + ChatGPT generation prompt live in Admin Import UI (`src/lib/questions/csv-import.ts`).

## Stats (Phase 10)

**question_stats** — `question_id`, `attempts_count`, `correct_count`, `p_value numeric`; refreshed by cron fn.
**test_stats** — `test_id`, registered/attempted/completed counts, avg/median/max/min.
