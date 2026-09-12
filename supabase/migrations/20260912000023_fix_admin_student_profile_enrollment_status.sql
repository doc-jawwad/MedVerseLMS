-- Fix: admin_student_profile hid suspended/revoked/expired enrollments entirely,
-- showing "no enrollment" for a student who is actually suspended (QA finding).
-- The enrollment lookup must return the student's most recent enrollment
-- regardless of status so the admin can see and act on it; only the
-- subject_access (practice-grant eligibility) panel should stay scoped to a
-- live (pending/active) enrollment, since that reflects real current access.
create or replace function public.admin_student_profile(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_enrollment jsonb;
  v_perf jsonb;
  v_grants jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select jsonb_build_object('full_name', full_name, 'email', email, 'last_login_at', last_login_at)
  into v_profile from public.profiles where id = p_student_id;

  select jsonb_build_object('status', e.status, 'year_id', e.year_id, 'year_name', y.name)
  into v_enrollment
  from public.enrollments e join public.years y on y.id = e.year_id
  where e.student_id = p_student_id
  order by e.created_at desc limit 1;

  select jsonb_build_object(
    'tests_taken', count(*),
    'average_percentage', round(coalesce(avg(percentage), 0), 2),
    'highest_percentage', coalesce(max(percentage), 0),
    'last_test_at', max(submitted_at)
  ) into v_perf
  from public.test_attempts where student_id = p_student_id and state = 'submitted';

  select jsonb_agg(jsonb_build_object(
    'subject_id', s.id, 'subject_name', s.name,
    'practice_granted', exists (
      select 1 from public.access_grants g
      where g.student_id = p_student_id and g.grant_type = 'practice_subject'
        and g.subject_id = s.id and g.revoked_at is null
    )
  ))
  into v_grants
  from public.subjects s
  join public.enrollments e on e.year_id = s.year_id and e.student_id = p_student_id
  where e.status in ('pending', 'active');

  return jsonb_build_object(
    'profile', v_profile,
    'enrollment', v_enrollment,
    'performance', v_perf,
    'subject_access', coalesce(v_grants, '[]'::jsonb)
  );
end;
$$;
