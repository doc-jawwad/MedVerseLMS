-- #38 focused R2 corrections. Layered on 20261127120000; no existing-row
-- DML, grants/policies changes or historical repair.
--
-- Permission remains first in reorder. Lock the source test membership,
-- then its parent, then any newly committed links, before selecting neighbors.

create or replace function public.reorder_test_question(
  p_test_id uuid, p_question_id uuid, p_direction text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a record;
  v_b record;
begin
  perform public.require_permission('publish_tests');
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction: %', p_direction;
  end if;

  -- Serialize membership and position selection, not just the final two
  -- updates. A concurrent draft reparent/delete can otherwise invalidate
  -- both row ids and adjacency while we wait on a selected link.
  perform public.private_lock_test_links(p_test_id);
  perform 1 from public.tests t where t.id = p_test_id for no key update of t;
  if not found then
    raise exception 'question not found in this test';
  end if;
  perform public.private_lock_test_links(p_test_id);

  select id, position into v_a
  from public.test_questions
  where test_id = p_test_id and question_id = p_question_id;
  if not found then
    raise exception 'question not found in this test';
  end if;

  if p_direction = 'up' then
    select id, position into v_b
    from public.test_questions
    where test_id = p_test_id and position < v_a.position
    order by position desc limit 1;
  else
    select id, position into v_b
    from public.test_questions
    where test_id = p_test_id and position > v_a.position
    order by position asc limit 1;
  end if;

  if not found then
    return; -- already first/last: no-op, same as the previous implementation
  end if;

  -- Both rows and the parent are held. The explicit test scope also
  -- prevents accidentally updating a row belonging to another test.
  update public.test_questions set position = v_b.position
  where id = v_a.id and test_id = p_test_id;
  update public.test_questions set position = v_a.position
  where id = v_b.id and test_id = p_test_id;
end;
$$;

-- PostgreSQL BEFORE INSERT row triggers execute before RLS WITH CHECK.
-- Stop unauthorized API callers before the existing SECURITY DEFINER year
-- trigger can read or lock a parent. This is invoker-security: internal
-- owner-run functions and existing privileged fixture/service paths retain
-- their prior semantics. RLS remains authoritative and unchanged.
create function public.require_test_question_insert_permission()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user = 'anon' then
    raise exception 'new row violates row-level security policy for table "test_questions"'
      using errcode = '42501';
  elsif current_user = 'authenticated' then
    if not coalesce(public.has_permission('publish_tests'), false) then
      raise exception 'new row violates row-level security policy for table "test_questions"'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.require_test_question_insert_permission()
  from public, anon, authenticated, service_role;

-- Alphabetical order: this must run before test_questions_enforce_year_on_link.
create trigger test_questions_aa_require_insert_permission
  before insert on public.test_questions
  for each row execute function public.require_test_question_insert_permission();
