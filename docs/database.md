# Database Schema (canonical)

Conventions: every table has `id uuid primary key default gen_random_uuid()`, `tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger-maintained). RLS enabled on **every** table, deny-by-default. State columns are text enums via CHECK — never boolean flags.

## Identity

**profiles** — pk = `auth.users.id`. `full_name`, `email`, `role text check (role in ('admin','student')) default 'student'`, `active_session_id uuid`, `last_login_at timestamptz`.
- Created by trigger `handle_new_user()` on auth.users insert; role always `'student'` (admins promoted via SQL/service role only).
- Trigger blocks any change to `role` unless performed by admin/service role.

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

**question_versions** — **immutable, append-only**:
- `question_id`, `version_no int` (unique per question), `stem text`, `options jsonb` (array of `{key:'A'..'E', text}` — 4 or 5 entries), `correct_key char(1)`, `explanation text`, `reference text`
- UPDATE/DELETE blocked by trigger (raises) AND absent RLS policies.
- Editing a question = `create_question_version(question_id, ...)` fn: inserts version_no = max+1, updates `questions.current_version_id`, `content_hash`, `stem_normalized` atomically.

`correct_key`/`explanation` must never reach a student before they answer: exam questions served via RPC that omits them; practice answers checked server-side by RPC.

## Enrollment & access

**enrollments** — `student_id`, `year_id`, `status check in ('pending','active','suspended','expired','revoked')`, `approved_by`, `approved_at`, `expires_at`.
- Partial unique index: `(student_id) WHERE status in ('pending','active')` — one live enrollment.
- `promote_student(student_id)`: sets active row `expired`, inserts active row for year+1. Audit-logged.

**access_grants** — `student_id`, `grant_type check in ('practice_subject','test','materials_folder')`, `subject_id`, `test_id`, `folder_id`, `granted_by`, `revoked_at` (null = active). CHECK: exactly one target column non-null and matching grant_type.

**test_audiences** — `test_id`, `year_id`: whole-cohort access to a test (the normal case); per-student `access_grants(test)` is the override/extra path.

**audit_logs** — `actor_id`, `action text`, `target_type text`, `target_id uuid`, `details jsonb`, `created_at`. Written by admin RPCs (publish, close, invalidate, void, grant/revoke, promote, attempt reset). Insert-only.

## Tests

**tests** — `title`, `year_id`, `subject_id null`, `status text check in ('draft','published','closed','archived','invalidated') default 'draft'`, `opens_at`, `closes_at`, `duration_minutes int`, `marks_per_question numeric(6,2) default 1`, `negative_mark numeric(4,2) default 0`, `shuffle_questions bool default true`, `shuffle_options bool default false`, `show_review text check in ('after_submit','after_close','never') default 'after_close'`, `min_questions int default 1`, `created_by`.
("live" is derived: `status='published' and now() between opens_at and closes_at` — not a stored state.)

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

**attempt_answers** — `attempt_id`, `question_version_id`, `selected_key char(1) null` (null = cleared), `marked_for_review bool default false`, `answered_at`, `time_spent_ms int`, `save_seq bigint`. **Unique (attempt_id, question_version_id)** → autosave = upsert with `save_seq` monotonic guard.

## Practice

**practice_seen** — `student_id`, `question_id`, `cycle int default 1`, `last_seen_at`. Unique (student_id, question_id).
**practice_answers** — `student_id`, `question_version_id`, `selected_key`, `is_correct bool`, `answered_at`, denormalized `subject_id, chapter_id, topic_id`.

## Materials

**material_folders** — `name`, `year_id`, `subject_id null`, `sort_order`.
**materials** — `folder_id`, `title`, `description`, `file_type text`, `drive_url text`.

## Import

**import_batches** — `created_by`, `filename`, `total_rows`, `inserted`, `skipped_duplicates`, `errors`.
**import_rows** — `batch_id`, `row_number`, `outcome check in ('inserted','skipped_duplicate','error')`, `error_message`, `question_id null`.

## Stats (Phase 10)

**question_stats** — `question_id`, `attempts_count`, `correct_count`, `p_value numeric`; refreshed by cron fn.
**test_stats** — `test_id`, registered/attempted/completed counts, avg/median/max/min.
