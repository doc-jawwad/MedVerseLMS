-- P1 security hardening (docs/performance-implementation-plan.md P1-2): pin
-- search_path on public-schema functions the security advisor flagged as
-- mutable. Uses ALTER FUNCTION ... SET, not CREATE OR REPLACE, so function
-- bodies are untouched — this only pins the search_path, nothing else.
--
-- Scope: the advisor flagged 20 functions total. 8 of them
-- (test_helpers.as_user/as_runner/make_student/as_anon/make_question/
-- make_curriculum/make_admin/make_published_test) live in the test_helpers
-- schema defined by supabase/tests/000_helpers.sql, are pgTAP fixture-only,
-- are never exposed via the Data API (PostgREST only exposes public/
-- graphql_public per supabase/config.toml), and are not part of the
-- migrations-managed schema — out of scope for a production migration.
-- The remaining 12 are handled here. All are non-SECURITY-DEFINER trigger
-- or pure-computation helpers whose bodies already schema-qualify every
-- table/function reference (verified by reading each definition), so
-- `search_path = public` is safe and matches the convention already used
-- by every exam-critical SECURITY DEFINER function in this codebase.

alter function public.set_updated_at() set search_path = public;
alter function public.default_tenant() set search_path = public;

alter function public.sync_book_ancestors() set search_path = public;
alter function public.sync_chapter_ancestors() set search_path = public;
alter function public.sync_topic_ancestors() set search_path = public;
alter function public.sync_question_ancestors() set search_path = public;

alter function public.forbid_version_mutation() set search_path = public;
alter function public.protect_published_test() set search_path = public;
alter function public.protect_published_test_questions() set search_path = public;

alter function public.validate_question_content(jsonb, char) set search_path = public;
alter function public.question_content_hash(text, jsonb, char) set search_path = public;
alter function public.normalize_stem(text) set search_path = public;
