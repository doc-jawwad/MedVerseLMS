-- Issue #11: constrain existing student read permissions; grants stay unchanged.
-- Current/live class wins over expired enrollment history. Without one, use the
-- most recent enrollment, as admin_student_profile already does. No enrollment
-- means no limited-admin student access; Main Admin retains recovery access.
create or replace function public.admin_can_read_student_class(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_admin()
  and (public.can_admin_select_profiles() or public.can_admin_select_enrollments()
    or public.can_admin_select_attempts() or public.can_admin_select_attempt_detail())
  and (
    public.is_main_admin()
    or (
      exists (select 1 from public.profiles p
        where p.id = p_student_id and p.role = 'student')
      and public.admin_can_access_year((
        select e.year_id from public.enrollments e
        where e.student_id = p_student_id
        order by (e.status = 'active') desc, e.created_at desc, e.id desc
        limit 1
      ))
    )
    or (public.has_permission('manage_admins') and exists (
      select 1 from public.profiles p where p.id = p_student_id and p.role = 'admin'
    ))
  );
$$;
revoke all on function public.admin_can_read_student_class(uuid) from public, anon;
grant execute on function public.admin_can_read_student_class(uuid) to authenticated, service_role;

-- Restrictive policies intersect the existing permission policies. They cannot
-- grant a role/table combination access that its existing policy denies.
create policy profiles_admin_class_read_scope on public.profiles
as restrictive for select to authenticated using (
  id = (select auth.uid()) or public.admin_can_read_student_class(id)
);
create policy enrollments_admin_class_read_scope on public.enrollments
as restrictive for select to authenticated using (
  student_id = (select auth.uid())
  or (public.admin_can_read_student_class(student_id) and public.admin_can_access_year(year_id))
);
create policy test_attempts_admin_class_read_scope on public.test_attempts
as restrictive for select to authenticated using (
  student_id = (select auth.uid()) or public.admin_can_read_student_class(student_id)
);
create policy practice_answers_admin_class_read_scope on public.practice_answers
as restrictive for select to authenticated using (
  student_id = (select auth.uid()) or public.admin_can_read_student_class(student_id)
);

-- This SECURITY DEFINER RPC bypasses RLS, so it needs the same explicit gate.
-- Preserve its existing view_students permission, ranked-attempt aggregates,
-- output and grants. Do not expose Auth metadata before this gate succeeds.
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
  select jsonb_build_object('full_name', full_name, 'email', email, 'last_login_at', last_login_at)
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
