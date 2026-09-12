---
name: medverse-database
description: Use when creating or changing database schema, RLS policies, RPCs, or question-bank data in MedVerse LMS — migration-first workflow, RLS-by-default, tenant_id, immutable question versions, and approved-RPC usage. Source of truth is docs/database.md, docs/permissions.md, docs/architecture.md.
---

# MedVerse Database Skill

Canonical sources: [docs/architecture.md](../../../docs/architecture.md), [docs/database.md](../../../docs/database.md), [docs/permissions.md](../../../docs/permissions.md). If anything here conflicts with those docs, the docs win — **do not invent alternative states, transitions, grace periods, or access rules.** Change the doc first (with approval), then the code.

## Migration-first workflow

- `supabase/migrations/*.sql` is the **only** source of schema truth. Never make dashboard-only changes.
- New change: `supabase migration new <name>` → write SQL → `supabase db reset` locally (replays all migrations + `seed.sql`) → commit.
- Cloud: `supabase db push` (or `supabase migration up`) via CI, never ad hoc.
- **[Team convention, not a canonical doc rule]** Do not modify an already-applied/committed migration file after the fact — add a new migration instead. This is a project/team convention modeled on the immutability principle the canonical docs apply elsewhere (append-only question versions, immutable attempts), not itself a rule stated in `docs/deployment.md` or `docs/database.md`. Treat it as a recommended practice; if it should become canonical, it needs to be added to `docs/deployment.md`'s "Migrations" section first (with approval), per the project's own "change the doc first" rule.
- During development in this session: **no production schema or data modification.** Inspect existing tables (`list_tables`, `list_migrations`) before proposing changes; use `execute_sql` for read-only inspection, not for ad hoc writes; schema writes go through `apply_migration`/a checked-in migration file, never a one-off `execute_sql` DDL statement against production.

## RLS-by-default

- RLS is enabled on **every** table, deny-by-default: only the access explicitly listed in the [permissions.md RLS matrix](../../../docs/permissions.md) exists. If a table/role pair isn't in that matrix, it has no access — don't add convenience policies beyond it.
- State columns are text enums via `CHECK (... in (...))` — never boolean flag soup.
- Use the existing security-definer helpers inside policies rather than re-deriving logic: `is_admin()`, `is_active_session()`, `has_active_enrollment(p_year_id)`, `can_access_test(p_test_id)`. These are `SECURITY DEFINER, set search_path = public` specifically to avoid RLS recursion — new policies should reuse them, not reimplement the checks inline.
- Hard guarantees that must never be bypassable (and are pgTAP-tested): a student can't read another student's profile/attempts/answers/enrollment/results; can't read a question's `correct_key`/`explanation` before answering; can't read an ungranted/unpublished test (direct `/tests/123` → 0 rows); can't write questions/tests/grants or their own `role`; can't mutate attempts outside the RPCs.

## tenant_id rules

- Every table has `tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'` from day one, even though there is a single tenant today — this is for future multi-academy support. Never omit it on a new table.
- Curriculum tables denormalize `year_id`/`subject_id`/`book_id`/`chapter_id` downward (e.g. `chapters` carries `subject_id, year_id`; `topics` carries `book_id, subject_id, year_id`) specifically to keep RLS join-free. Maintain these via trigger from the parent on insert/update — never require the RLS policy itself to walk the hierarchy.

## Database integrity

- `id uuid primary key default gen_random_uuid()`, `created_at`/`updated_at timestamptz default now()` (updated_at trigger-maintained) on every table — follow the existing convention, don't hand-roll a variant.
- Use partial unique indexes for "one live X" invariants exactly as already established — e.g. `(test_id, student_id) WHERE state != 'invalidated'` for attempts, `(student_id) WHERE status in ('pending','active')` for enrollments. Don't reimplement this as an application-level check.
- `access_grants` enforces "exactly one target column matches grant_type" via CHECK — follow this pattern (CHECK constraints over app-level validation) for any similar exactly-one-of-N-columns invariant.
- `audit_logs` is insert-only, written only by admin RPCs (publish, close, invalidate, void, grant/revoke, promote, attempt reset). Any new admin mutation "of consequence" must audit-log the same way.

## Approved RPC usage

- Students have **no direct INSERT/UPDATE/DELETE** on `test_attempts`, `questions`, `question_versions`, `test_questions`, or grants — everything mutates through `SECURITY DEFINER` RPCs that check ownership + state + device as documented in `exam-state-machine.md`. Never add a new RLS policy that grants students direct write access to these tables as a shortcut.
- Practice and exam question delivery to students goes through RPCs that omit `correct_key`/`explanation` for unanswered exam questions — never expose these columns via a direct SELECT policy.
- Everything security- or correctness-critical belongs in Postgres (RLS, constraints, unique indexes, security-definer RPCs). App-level checks in Next.js/TypeScript are UX convenience only, never the actual security boundary.

## Immutable question versions

- `question_versions` is append-only: UPDATE/DELETE are blocked by trigger (raises) and by the absence of any RLS policy permitting them, for any role.
- The only way to "edit" a question is `create_question_version(question_id, ...)`: inserts `version_no = max+1`, updates `questions.current_version_id`, `content_hash`, `stem_normalized` atomically. Never write a migration or RPC that updates an existing version row in place.
- `test_questions.question_version_id` is frozen at publish and immutable after publish (trigger-enforced), except `voided`/`void_policy`. Never re-point a published test's frozen version except via the documented explicit admin re-freeze action (only while `now() < opens_at`, audit-logged).
- Scoring and any question-content query for a submitted/in-progress attempt must reference `test_questions.question_version_id` / `attempt_answers.question_version_id` — **never** `questions.current_version_id` (scoring must be a pure, reproducible function of frozen data, per scoring-rules.md).
- `questions.used_in_test` is a derived UI cache only — never treat it as authoritative for security, eligibility, or historical truth. Authoritative truth is the existence of a published `test_questions` row.
- This rule is intentionally also stated in `medverse-exam-engine`'s "Question-version freezing" section, from the exam-runtime angle rather than the schema/migration angle. The duplication is deliberate — if the two ever appear to disagree, both must defer to [docs/database.md](../../../docs/database.md), [docs/test-rules.md](../../../docs/test-rules.md), and [docs/scoring-rules.md](../../../docs/scoring-rules.md), never to each other.

## No production schema/data modification during development

- Do not run destructive or write SQL directly against the connected Supabase project outside a checked-in migration. The connected project (`jawwadseoxpert@gmail.com's Project`, ref `pxoxijlhcvbrostrquft`) may be a live/shared environment — treat any `execute_sql` write, `apply_migration`, or `reset_branch` call as something requiring explicit user confirmation first, per the outer session's action-category rules.
- Prefer local (`supabase start` / `supabase db reset`) or a Supabase branch for iteration; only push to the linked cloud project deliberately and when asked.

## Testing requirements

- `npm run test:db` runs the pgTAP suite in `supabase/tests/` (RLS matrix + scoring/exam-engine regressions) against `SUPABASE_DB_URL` via `scripts/run-pgtap.mjs`. Every test file wraps fixtures in `BEGIN...ROLLBACK` — safe to run against a shared dev/cloud database since nothing persists.
- Any new table, RLS policy, or RPC should get corresponding pgTAP coverage for: the RLS matrix (who can/can't read or write it) and any new invariant (uniqueness, immutability, state-transition guard).
- Before declaring a schema change "done," confirm `supabase db reset` replays cleanly and `npm run test:db` passes.
