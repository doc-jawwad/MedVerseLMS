-- Align Student 360 projection with the existing active-first class gate.
-- Existing permissions, grants, ranked aggregates and Main Admin access retained.
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
    where e.student_id = p_student_id
    order by (e.status = 'active') desc, e.created_at desc, e.id desc limit 1;
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
    where e.status in ('pending', 'active')
      and public.admin_can_access_year(e.year_id);
  return jsonb_build_object('profile', v_profile, 'enrollment', v_enrollment,
    'performance', v_perf, 'subject_access', coalesce(v_grants, '[]'::jsonb));
end;
$$;

notify pgrst, 'reload schema';
