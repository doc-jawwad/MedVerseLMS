-- Fix for the log_audit() authorization gap found during the P1 security
-- review (docs/performance-baseline.md §20.1): log_audit() is SECURITY
-- DEFINER and `authenticated` legitimately needs EXECUTE on it (the admin
-- Server Actions in src/lib/actions/enrollment.ts call it directly via the
-- caller's own session), but the function itself performed no internal
-- caller check — unlike every other admin-only SECURITY DEFINER function
-- in this codebase (set_enrollment_status, promote_student, publish_test,
-- close_test_now, invalidate_test, void_test_question, invalidate_attempt
-- all check is_admin() first). That meant any authenticated (non-admin)
-- user could call log_audit() directly through the Data API and insert a
-- fabricated audit_logs row (arbitrary action/target_type/target_id/
-- details; only actor_id was pinned to their own auth.uid()).
--
-- Fix: add the same `if not public.is_admin() then raise exception
-- 'admin only'; end if;` guard used everywhere else, before the INSERT.
-- Verified before writing this (all 7 production RPC callers already gate
-- on is_admin() before ever reaching log_audit, and both direct-call
-- Server Actions live on admin-only pages) that no legitimate call path
-- relies on a non-admin ever reaching this function — so this cannot break
-- any real flow.
--
-- The original function is `language sql` (a single INSERT statement),
-- which cannot express an IF/RAISE guard. Converting to `language plpgsql`
-- is the minimal, necessary change to add the check — every other
-- admin-gated definer function in this codebase already uses plpgsql for
-- exactly this reason. Signature, return type, SECURITY DEFINER,
-- search_path, the INSERT statement, the actor_id (select auth.uid())
-- semantics, and the p_details default are all unchanged.
create or replace function public.log_audit(
  p_action text, p_target_type text, p_target_id uuid, p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  insert into public.audit_logs (actor_id, action, target_type, target_id, details)
  values ((select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
end;
$$;
