-- Re-seal internal ranking/scoring RPCs: EXECUTE must not be granted to
-- public/anon/authenticated. These are called only from other SECURITY DEFINER
-- functions (submit_attempt, auto_submit_expired, cron paths, etc.).
-- Staging drifted open (anon/auth/public EXECUTE true); production already sealed.
-- Does not change function bodies or ranking semantics.

revoke execute on function public.score_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.rank_test(uuid) from public, anon, authenticated;
revoke execute on function public.recompute_test(uuid) from public, anon, authenticated;
revoke execute on function public.finalize_if_expired(uuid) from public, anon, authenticated;
revoke execute on function public.auto_submit_expired() from public, anon, authenticated;
revoke execute on function public.rank_dirty_tests() from public, anon, authenticated;

-- log_audit is internal-only (admin RPCs call it as definer); no direct callers.
revoke execute on function public.log_audit(text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.log_audit(text, text, uuid, jsonb)
  to service_role;

-- Keep service_role for ops/cron tooling that may invoke these internals.
grant execute on function public.auto_submit_expired() to service_role;
grant execute on function public.rank_dirty_tests() to service_role;
grant execute on function public.finalize_if_expired(uuid) to service_role;
grant execute on function public.score_attempt(uuid) to service_role;
grant execute on function public.rank_test(uuid) to service_role;
grant execute on function public.recompute_test(uuid) to service_role;
