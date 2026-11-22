-- Perf: evaluate admin SELECT RLS predicates once per statement, not once per row.
--
-- Incident 2026-11-15 (PGRST003 pool exhaustion): the Question Bank / Test Builder /
-- Prof. Session day queries scanned thousands of `questions` rows. The policy
-- `questions_admin_select` called `public.can_admin_select_questions()` bare, so
-- Postgres re-ran it (has_permission x2 -> is_admin + is_main_admin + admin_permissions
-- lookups) for EVERY candidate row, and again per embedded question_versions /
-- subjects / chapters / topics row. Wrapping the call in `(select ...)` turns it into
-- an InitPlan evaluated once per statement (the documented Supabase RLS pattern; the
-- repo already does this for auth.uid()).
--
-- Semantics are unchanged: each predicate depends only on auth.uid() / the caller's
-- role, which is constant for the statement. Same policy names, commands and roles.
-- No data, index, grant or function-body changes. Reversible by re-running the
-- previous migrations' policy definitions (20260919140000, 20260925150000).

drop policy if exists questions_admin_select on public.questions;
create policy questions_admin_select on public.questions
  for select using ((select public.can_admin_select_questions()));

drop policy if exists question_versions_admin_select on public.question_versions;
create policy question_versions_admin_select on public.question_versions
  for select using ((select public.can_admin_select_questions()));

drop policy if exists subjects_admin_select on public.subjects;
create policy subjects_admin_select on public.subjects
  for select using ((select public.is_admin()));

drop policy if exists books_admin_select on public.books;
create policy books_admin_select on public.books
  for select using ((select public.is_admin()));

drop policy if exists chapters_admin_select on public.chapters;
create policy chapters_admin_select on public.chapters
  for select using ((select public.is_admin()));

drop policy if exists topics_admin_select on public.topics;
create policy topics_admin_select on public.topics
  for select using ((select public.is_admin()));
