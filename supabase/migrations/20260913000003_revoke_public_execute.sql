-- Follow-up to 20260913000002_revoke_unnecessary_execute.sql. Verification
-- after applying that migration showed anon/authenticated still had
-- effective EXECUTE on every function touched, because Postgres grants
-- EXECUTE to the PUBLIC pseudo-role by default when a function is created,
-- and every role (including anon) is implicitly a member of PUBLIC. The
-- REVOKE ... FROM anon/authenticated in 20260913000002 correctly removed
-- those roles' own direct grants (confirmed via pg_proc.proacl), but did
-- not touch the separate PUBLIC grant, which alone was still enough to
-- give anon/authenticated effective access.
--
-- Verified via pg_proc.proacl before writing this: every Group A function
-- below (including log_audit) carries its OWN independent
-- `authenticated=X` grant entry, separate from the `=X` (PUBLIC) entry —
-- so revoking PUBLIC here removes anon's (and any other role's) inherited
-- access while leaving `authenticated` fully intact via its own grant.
-- Group B functions no longer have any anon/authenticated entries at all
-- after 20260913000002, so revoking PUBLIC leaves only postgres/service_role.

revoke execute on function public.admin_platform_summary() from public;
revoke execute on function public.admin_student_profile(uuid) from public;
revoke execute on function public.close_test_now(uuid) from public;
revoke execute on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text) from public;
revoke execute on function public.create_question_version(uuid, text, jsonb, char, text, text) from public;
revoke execute on function public.import_question_batch(uuid, jsonb, boolean) from public;
revoke execute on function public.invalidate_attempt(uuid, text) from public;
revoke execute on function public.invalidate_test(uuid, text) from public;
revoke execute on function public.promote_student(uuid) from public;
revoke execute on function public.publish_test(uuid) from public;
revoke execute on function public.question_difficulty_report(integer) from public;
revoke execute on function public.set_enrollment_status(uuid, text) from public;
revoke execute on function public.test_summary(uuid) from public;
revoke execute on function public.validate_test(uuid) from public;
revoke execute on function public.void_test_question(uuid, uuid, text) from public;
revoke execute on function public.log_audit(text, text, uuid, jsonb) from public;

revoke execute on function public.score_attempt(uuid) from public;
revoke execute on function public.rank_test(uuid) from public;
revoke execute on function public.recompute_test(uuid) from public;
revoke execute on function public.finalize_if_expired(uuid) from public;
revoke execute on function public.auto_submit_expired() from public;
