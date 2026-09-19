-- Fix self_change_class: do not call admin-only log_audit from student path.
-- Student self-serve class change is not an admin mutation of consequence.

create or replace function public.self_change_class(p_year_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_lock jsonb;
  v_current public.enrollments%rowtype;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_lock := public.get_class_lock_state();
  if (v_lock->>'lock') is distinct from 'free' then
    raise exception 'class_locked';
  end if;

  if not exists (select 1 from public.years where id = p_year_id) then
    raise exception 'invalid_year';
  end if;

  select * into v_current
  from public.enrollments
  where student_id = v_uid and status = 'active'
  for update;

  if not found then
    raise exception 'no_active_enrollment';
  end if;

  if v_current.year_id = p_year_id then
    return jsonb_build_object('ok', true, 'year_id', p_year_id);
  end if;

  perform set_config('medverse.class_change_rpc', '1', true);

  update public.enrollments
  set status = 'expired'
  where id = v_current.id;

  insert into public.enrollments (student_id, year_id, status)
  values (v_uid, p_year_id, 'active')
  returning id into v_new_id;

  perform set_config('medverse.class_change_rpc', '', true);

  return jsonb_build_object('ok', true, 'year_id', p_year_id);
exception
  when others then
    perform set_config('medverse.class_change_rpc', '', true);
    raise;
end;
$$;
