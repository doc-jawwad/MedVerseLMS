-- 20260922000003: Bulk question soft-delete
-- Moves multiple questions to Bin in one call (7-day purge_after lifecycle).
-- Blocks deletion of questions referenced by non-draft / non-archived tests.

create or replace function public.bulk_soft_delete_questions(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_binned int := 0;
  v_blocked int := 0;
  v_not_found int := 0;
  v_blocked_ids uuid[] := '{}';
begin
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  if p_ids is null or array_length(p_ids, 1) = 0 then
    raise exception 'no ids provided';
  end if;

  foreach v_id in array p_ids loop
    -- Skip questions already in the bin or not found
    if not exists (select 1 from public.questions where id = v_id) then
      v_not_found := v_not_found + 1;
      continue;
    end if;

    -- Block if used in a published / closed test
    if exists (
      select 1 from public.test_questions tq
      join public.tests t on t.id = tq.test_id
      where tq.question_id = v_id
        and t.status not in ('draft', 'archived', 'invalidated')
    ) then
      v_blocked := v_blocked + 1;
      v_blocked_ids := v_blocked_ids || v_id;
      continue;
    end if;

    update public.questions
    set deleted_at = now(),
        purge_after = now() + interval '7 days',
        deleted_by = auth.uid()
    where id = v_id
      and deleted_at is null;

    if found then
      v_binned := v_binned + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'binned', v_binned,
    'blocked_active_test', v_blocked,
    'not_found', v_not_found,
    'blocked_ids', to_jsonb(v_blocked_ids)
  );
end;
$$;

revoke execute on function public.bulk_soft_delete_questions(uuid[]) from public, anon;
grant execute on function public.bulk_soft_delete_questions(uuid[]) to authenticated, service_role;
