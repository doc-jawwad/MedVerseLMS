-- Last active Main Admin cannot be blocked; admin targets need manage_admins.
-- Body of set_account_status is otherwise unchanged from 20260915033122.

create or replace function public.set_account_status(
  p_student_id uuid,
  p_status text,
  p_attempt_disposition text default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_role text;
  v_is_main boolean;
  v_blocking boolean;
  v_attempt public.test_attempts%rowtype;
begin
  if p_status = 'active' then
    perform public.require_permission('activate_students');
  elsif p_status in ('restricted', 'suspended', 'deactivated', 'revoked') then
    perform public.require_permission('restrict_students');
  else
    raise exception 'invalid account_status %', p_status;
  end if;

  select account_status, role, is_main_admin
    into v_old, v_role, v_is_main
  from public.profiles
  where id = p_student_id;
  if not found then
    raise exception 'profile not found';
  end if;

  if v_role = 'admin' then
    perform public.require_permission('manage_admins');
  end if;

  v_blocking := p_status in ('restricted', 'suspended', 'deactivated', 'revoked');

  if v_blocking and v_is_main
     and not exists (
       select 1 from public.profiles
       where is_main_admin
         and id != p_student_id
         and account_status = 'active'
     ) then
    raise exception 'cannot disable the last active Main Admin';
  end if;

  if v_blocking and exists (
    select 1 from public.test_attempts
    where student_id = p_student_id and state = 'in_progress'
  ) then
    if p_attempt_disposition is null
       or p_attempt_disposition not in ('leave_in_progress', 'invalidate', 'finalize') then
      raise exception 'attempt_disposition_required';
    end if;
    if p_attempt_disposition = 'invalidate' and coalesce(trim(p_reason), '') = '' then
      raise exception 'reason required';
    end if;

    for v_attempt in
      select * from public.test_attempts
      where student_id = p_student_id and state = 'in_progress'
    loop
      if p_attempt_disposition = 'invalidate' then
        update public.test_attempts
        set state = 'invalidated',
            invalidated_reason = p_reason,
            invalidated_by = (select auth.uid())
        where id = v_attempt.id and state = 'in_progress';
        perform public.log_audit(
          'attempt_invalidated',
          'attempt',
          v_attempt.id,
          jsonb_build_object('reason', p_reason, 'source', 'set_account_status')
        );
      elsif p_attempt_disposition = 'finalize' then
        update public.test_attempts
        set state = 'submitted',
            submitted_at = now(),
            submit_source = 'admin'
        where id = v_attempt.id and state = 'in_progress';
        perform public.score_attempt(v_attempt.id);
      end if;
    end loop;
  end if;

  perform set_config('medverse.set_account_status', '1', true);

  update public.profiles
  set account_status = p_status,
      active_session_id = case
        when v_blocking then null
        else active_session_id
      end
  where id = p_student_id;

  perform set_config('medverse.set_account_status', '', true);

  perform public.log_audit(
    'account_status_' || p_status,
    'profile',
    p_student_id,
    jsonb_build_object(
      'from', v_old,
      'to', p_status,
      'attempt_disposition', p_attempt_disposition
    )
  );
end;
$$;
