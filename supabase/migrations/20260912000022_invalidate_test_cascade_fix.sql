-- 0022: BUGFIX — invalidate_test() never cascaded to test_attempts, so a
-- student whose test was invalidated could still see their old score on
-- /tests/[id]/result (that page reads test_attempts directly, independent
-- of the parent test's status). docs/test-rules.md explicitly requires
-- "attempts marked invalidated; hidden from results" — this closes the gap.
-- Found via a direct-API kill-switch test, not caught by earlier test suites.

create or replace function public.invalidate_test(p_test_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;

  update public.tests set status = 'invalidated'
  where id = p_test_id and status in ('published', 'closed');
  if not found then raise exception 'test cannot be invalidated from its current state'; end if;

  -- Cascade: every attempt on this test is marked invalidated too (history
  -- preserved — state changes, rows are never deleted — same as
  -- invalidate_attempt's per-student path).
  update public.test_attempts
  set state = 'invalidated',
      invalidated_reason = p_reason,
      invalidated_by = (select auth.uid())
  where test_id = p_test_id and state in ('in_progress', 'submitted');

  perform public.log_audit('test_invalidated', 'test', p_test_id, jsonb_build_object('reason', p_reason));
end;
$$;
