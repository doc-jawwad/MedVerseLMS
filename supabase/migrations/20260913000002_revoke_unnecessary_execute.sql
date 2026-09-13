-- P1 security hardening (docs/performance-implementation-plan.md P1-3):
-- remove unnecessary EXECUTE grants on SECURITY DEFINER functions. This is
-- defense-in-depth only — every function below already re-checks
-- authorization internally (is_admin(), or has no direct legitimate caller
-- at all); REVOKE here does not replace or weaken those internal checks or
-- any RLS policy, and no RLS policy is touched by this migration.
--
-- Two groups, verified individually against pg_get_functiondef() and a
-- repo-wide grep of src/ for actual callers before writing this file:
--
-- Group A: admin-only RPCs (confirmed via functiondef to call is_admin()
-- as their first check, and confirmed via grep to be called only from
-- admin-only Server Actions/pages using the user's own authenticated
-- session). `anon` (unauthenticated) has no legitimate reason to be able
-- to even attempt calling these — `authenticated` is preserved since real
-- admins call them via their own logged-in session.
revoke execute on function public.admin_platform_summary() from anon;
revoke execute on function public.admin_student_profile(uuid) from anon;
revoke execute on function public.close_test_now(uuid) from anon;
revoke execute on function public.create_question(uuid, text, jsonb, char, text, text, text, text[], text) from anon;
revoke execute on function public.create_question_version(uuid, text, jsonb, char, text, text) from anon;
revoke execute on function public.import_question_batch(uuid, jsonb, boolean) from anon;
revoke execute on function public.invalidate_attempt(uuid, text) from anon;
revoke execute on function public.invalidate_test(uuid, text) from anon;
revoke execute on function public.promote_student(uuid) from anon;
revoke execute on function public.publish_test(uuid) from anon;
revoke execute on function public.question_difficulty_report(integer) from anon;
revoke execute on function public.set_enrollment_status(uuid, text) from anon;
revoke execute on function public.test_summary(uuid) from anon;
revoke execute on function public.validate_test(uuid) from anon;
revoke execute on function public.void_test_question(uuid, uuid, text) from anon;

-- log_audit: called directly by admin-only Server Actions
-- (src/lib/actions/enrollment.ts) using the caller's own authenticated
-- session, so `authenticated` is preserved for the same reason as Group A.
-- Note (found during this audit, not fixed here — see final report): unlike
-- every function above, log_audit itself does not call is_admin() or check
-- who is calling it; it currently relies entirely on only being reachable
-- from pages that happen to be admin-only. That is a real gap but fixing it
-- means changing the function's behavior/authorization logic, which is out
-- of scope for a grants-only hardening pass — flagged for a future,
-- reviewed change rather than altered here.
revoke execute on function public.log_audit(text, text, uuid, jsonb) from anon;

-- Group B: functions with no legitimate direct caller from ANY client
-- role at all (confirmed via grep: zero references in src/ except the one
-- cron route, which uses the service-role client and is unaffected by
-- revoking anon/authenticated). These are reached only as internal calls
-- from other SECURITY DEFINER functions (submit_attempt, start_attempt,
-- pg_cron's in-database call to auto_submit_expired), which do not require
-- explicit EXECUTE grants on the nested call. Revoking both anon and
-- authenticated closes an until-now-undocumented ability for any signed-in
-- user to call score_attempt/rank_test/recompute_test directly against an
-- arbitrary attempt/test id — not a data-exposure risk (these functions
-- return void and use deterministic, already-frozen inputs) but a needless
-- direct trigger for exactly the rank_test() cost this project is
-- deliberately NOT changing right now (see docs/performance-baseline.md).
-- This REVOKE does not modify rank_test()/score_attempt() bodies, timing,
-- or ranking semantics in any way — only who may call them directly.
revoke execute on function public.score_attempt(uuid) from anon, authenticated;
revoke execute on function public.rank_test(uuid) from anon, authenticated;
revoke execute on function public.recompute_test(uuid) from anon, authenticated;
revoke execute on function public.finalize_if_expired(uuid) from anon, authenticated;
revoke execute on function public.auto_submit_expired() from anon, authenticated;
