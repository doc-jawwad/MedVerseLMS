-- Draft test delete (documented in docs/test-rules.md: draft → delete allowed).
-- Product path: SECURITY DEFINER delete_draft_test — publish_tests only, draft only,
-- audit-logged. Companion: narrow tests_admin_delete RLS to status='draft' so a
-- direct table DELETE cannot wipe published/closed tests (and cascade attempts).
-- Does not introduce soft-delete/Bin for tests. Does not change publish/scoring.

create or replace function public.delete_draft_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_status text;
begin
  perform public.require_permission('publish_tests');

  if p_test_id is null then
    raise exception 'test_not_found';
  end if;

  select t.title, t.status
    into v_title, v_status
  from public.tests t
  where t.id = p_test_id
  for update;

  if not found then
    raise exception 'test_not_found';
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'test_not_draft';
  end if;

  -- Audit before hard delete (row gone afterward). Cascades composition rows
  -- (test_questions / test_audiences / test_prep_guidelines / access_grants).
  perform public.log_audit(
    'test_draft_deleted',
    'test',
    p_test_id,
    jsonb_build_object('title', v_title, 'status', v_status)
  );

  delete from public.tests where id = p_test_id;
end;
$$;

revoke execute on function public.delete_draft_test(uuid) from public, anon;
grant execute on function public.delete_draft_test(uuid) to authenticated, service_role;

-- Enforce the documented draft-only delete rule at the table boundary too.
drop policy if exists tests_admin_delete on public.tests;
create policy tests_admin_delete on public.tests
  for delete using (
    public.has_permission('publish_tests')
    and status = 'draft'
  );
