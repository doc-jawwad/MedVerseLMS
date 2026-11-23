-- Profile privacy composes column ACLs with the preceding class/RLS boundary.
create or replace function public.get_own_profile()
returns table (id uuid, full_name text, email text, college_name text, avatar_object_key text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  return query
    select p.id, p.full_name, p.email, p.college_name, p.avatar_object_key
    from public.profiles p where p.id = v_user_id;
end;
$$;

revoke all on function public.get_own_profile() from public, anon, service_role;
grant execute on function public.get_own_profile() to authenticated;

-- Return the existing session-watch decision without exposing the stored ID.
create or replace function public.current_session_id(p_require_token_session boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active_session_id is not null
      and (not p_require_token_session or public.current_session_id() is not null)
      and p.active_session_id is distinct from public.current_session_id()
  );
$$;

revoke all on function public.current_session_id(boolean) from public, anon, service_role;
grant execute on function public.current_session_id(boolean) to authenticated;

create or replace function public.admin_student_profile(p_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_profile jsonb; v_enrollment jsonb; v_perf jsonb; v_grants jsonb;
begin
  perform public.require_permission('view_students');
  if not public.admin_can_read_student_class(p_student_id) then
    raise exception 'year_scope_denied';
  end if;
  select jsonb_build_object('full_name', full_name, 'email', email, 'last_login_at', last_login_at,
    'college_name', college_name, 'avatar_object_key', avatar_object_key, 'account_status', account_status)
    into v_profile from public.profiles where id = p_student_id;
  select jsonb_build_object('status', e.status, 'year_id', e.year_id, 'year_name', y.name)
    into v_enrollment from public.enrollments e join public.years y on y.id = e.year_id
    where e.student_id = p_student_id order by e.created_at desc limit 1;
  select jsonb_build_object('tests_taken', count(*),
    'average_percentage', round(coalesce(avg(percentage), 0), 2),
    'highest_percentage', coalesce(max(percentage), 0), 'last_test_at', max(submitted_at))
    into v_perf from public.ranked_test_attempts where student_id = p_student_id;
  select jsonb_agg(jsonb_build_object('subject_id', s.id, 'subject_name', s.name,
    'practice_granted', exists (select 1 from public.access_grants g
      where g.student_id = p_student_id and g.grant_type = 'practice_subject'
        and g.subject_id = s.id and g.revoked_at is null)))
    into v_grants from public.subjects s
    join public.enrollments e on e.year_id = s.year_id and e.student_id = p_student_id
    where e.status in ('pending', 'active');
  return jsonb_build_object('profile', v_profile, 'enrollment', v_enrollment,
    'performance', v_perf, 'subject_access', coalesce(v_grants, '[]'::jsonb));
end;
$$;

create or replace function public.authorize_avatar_object(p_student_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid;
  v_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_active_session() then
    raise exception 'avatar_forbidden';
  end if;

  v_target := coalesce(p_student_id, v_uid);

  if v_target is distinct from v_uid
     and (not public.has_permission('view_students')
          or not public.admin_can_read_student_class(v_target)) then
    raise exception 'avatar_forbidden';
  end if;

  select avatar_object_key into v_key
  from public.profiles
  where id = v_target;

  if v_key is null
     or v_key !~ ('^study-content/avatars/' || v_target::text || '/[0-9a-f-]+$') then
    raise exception 'avatar_not_found';
  end if;

  return v_key;
end;
$$;

-- Email is a selector for the existing audited promotion action. UUID
-- callers keep their original signature and grants. The row lock prevents
-- a second promotion from resetting admin state on the same target.
create or replace function public.set_admin_role(p_email text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
begin
  perform public.require_permission('manage_admins');
  if nullif(btrim(p_email), '') is null then
    raise exception 'profile not found';
  end if;

  begin
    select p.id, p.role into strict v_id, v_role
    from public.profiles p
    where lower(p.email) = lower(btrim(p_email))
      and public.admin_can_read_student_class(p.id)
    for update;
  exception
    when no_data_found then raise exception 'profile not found';
    when too_many_rows then raise exception 'ambiguous profile email';
  end;

  if v_role <> 'student' then
    raise exception 'That account is already an admin.';
  end if;

  perform public.set_admin_role(v_id, true);
  return v_id;
end;
$$;

revoke all on function public.set_admin_role(text) from public, anon, service_role;
grant execute on function public.set_admin_role(text) to authenticated;

notify pgrst, 'reload schema';
