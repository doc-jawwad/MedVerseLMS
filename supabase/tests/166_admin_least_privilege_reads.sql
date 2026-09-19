-- F1: admin least-privilege sensitive reads (PostgREST RLS + DEFINER RPCs).
begin;
select plan(32);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'F1 Student') as id
  into temp t_student;
select test_helpers.make_admin('F1 Main Admin') as id into temp t_main;
select test_helpers.make_limited_admin(
  'F1 Academic',
  array['edit_questions', 'import_questions', 'publish_tests', 'manage_materials', 'view_analytics']
) as id into temp t_academic;
select test_helpers.make_limited_admin('F1 ViewStudents', array['view_students']) as id
  into temp t_view;
select test_helpers.make_limited_admin(
  'F1 OpsSubs',
  array['manage_subscriptions', 'review_subscription_applications', 'manage_payment_settings']
) as id into temp t_subs;
select test_helpers.make_limited_admin('F1 Year', array['manage_year_changes']) as id
  into temp t_year;
select test_helpers.make_limited_admin('F1 Admins', array['manage_admins']) as id
  into temp t_mgr;
select test_helpers.make_limited_admin('F1 Zero', '{}') as id into temp t_zero;

grant select on curriculum, t_student, t_main, t_academic, t_view, t_subs, t_year,
  t_mgr, t_zero to anon, authenticated;

-- Seed one sensitive row of each kind (runner bypasses RLS).
select test_helpers.as_runner();
insert into public.audit_logs (actor_id, action, target_type, target_id, details)
values (
  (select id from t_main),
  'f1_fixture',
  'test',
  (select id from t_student),
  '{}'::jsonb
);

insert into public.subscriptions (student_id, plan_id, status, starts_at, ends_at)
select
  (select id from t_student),
  (select id from public.subscription_plans where is_active order by sort_order limit 1),
  'active',
  now() - interval '1 day',
  now() + interval '30 days'
where not exists (
  select 1 from public.subscriptions
  where student_id = (select id from t_student) and status = 'active'
);

------------------------------------------------------------------
-- 1) Main Admin can read all sensitive tables
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select is(
  (select count(*)::int from public.profiles where role = 'student'),
  1,
  'Main Admin can SELECT student profiles'
);
select ok(
  (select count(*)::int from public.subscriptions) >= 1,
  'Main Admin can SELECT subscriptions'
);
select ok(
  (select count(*)::int from public.audit_logs) >= 1,
  'Main Admin can SELECT audit_logs'
);
select ok(
  (select count(*)::int from public.payment_settings) >= 1,
  'Main Admin can SELECT payment_settings'
);

------------------------------------------------------------------
-- 2) Academic cannot read student/ops sensitive tables via PostgREST
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select is(
  (select count(*)::int from public.profiles where id <> (select auth.uid())),
  0,
  'Academic cannot SELECT other profiles'
);
select is(
  (select count(*)::int from public.subscriptions),
  0,
  'Academic cannot SELECT subscriptions'
);
select is(
  (select count(*)::int from public.subscription_applications),
  0,
  'Academic cannot SELECT subscription_applications'
);
select is(
  (select count(*)::int from public.payment_settings),
  0,
  'Academic cannot SELECT payment_settings'
);
select is(
  (select count(*)::int from public.audit_logs),
  0,
  'Academic cannot SELECT audit_logs'
);
select is(
  (select count(*)::int from public.year_change_requests),
  0,
  'Academic cannot SELECT year_change_requests'
);
select is(
  (select count(*)::int from public.enrollments where student_id <> (select auth.uid())),
  0,
  'Academic cannot SELECT other enrollments'
);

------------------------------------------------------------------
-- 3) Limited ops admins can read only their mapped tables
------------------------------------------------------------------
select test_helpers.as_user((select id from t_view));
select is(
  (select count(*)::int from public.profiles where role = 'student'),
  1,
  'view_students can SELECT student profiles'
);
select is(
  (select count(*)::int from public.subscriptions),
  0,
  'view_students cannot SELECT subscriptions'
);
select is(
  (select count(*)::int from public.audit_logs),
  0,
  'view_students cannot SELECT audit_logs'
);

select test_helpers.as_user((select id from t_subs));
select ok(
  (select count(*)::int from public.subscriptions) >= 1,
  'manage_subscriptions can SELECT subscriptions'
);
select ok(
  (select count(*)::int from public.payment_settings) >= 1,
  'manage_payment_settings can SELECT payment_settings'
);
select is(
  (select count(*)::int from public.audit_logs),
  0,
  'subscription ops cannot SELECT audit_logs'
);
select ok(
  (select count(*)::int from public.profiles where role = 'student') >= 1,
  'subscription ops can SELECT profiles for joins'
);

select test_helpers.as_user((select id from t_year));
select is(
  (select count(*)::int from public.year_change_requests),
  0,
  'manage_year_changes can SELECT year_change_requests (empty ok)'
);
select ok(
  public.has_permission('manage_year_changes'),
  'year admin has manage_year_changes'
);
select is(
  (select count(*)::int from public.subscriptions),
  0,
  'manage_year_changes cannot SELECT subscriptions'
);

select test_helpers.as_user((select id from t_mgr));
select ok(
  (select count(*)::int from public.audit_logs) >= 1,
  'manage_admins can SELECT audit_logs'
);
select is(
  (select count(*)::int from public.subscriptions),
  0,
  'manage_admins alone cannot SELECT subscriptions'
);

------------------------------------------------------------------
-- 4) Zero-permission admin and student isolation
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select is(
  (select count(*)::int from public.profiles where id = (select auth.uid())),
  1,
  'zero-permission admin can still SELECT own profile'
);
select is(
  (select count(*)::int from public.profiles where id <> (select auth.uid())),
  0,
  'zero-permission admin cannot SELECT other profiles'
);
select is(
  (select count(*)::int from public.audit_logs),
  0,
  'zero-permission admin cannot SELECT audit_logs'
);

select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.profiles where id <> (select auth.uid())),
  0,
  'student cannot SELECT other profiles'
);
select is(
  (select count(*)::int from public.audit_logs),
  0,
  'student cannot SELECT audit_logs'
);
select is(
  (select count(*)::int from public.payment_settings),
  0,
  'student cannot SELECT payment_settings'
);
select throws_ok(
  $$select public.admin_platform_summary()$$,
  'admin only',
  'student cannot call admin analytics RPC'
);

------------------------------------------------------------------
-- 5) DEFINER helpers keep search_path + Academic still gets analytics RPCs
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select lives_ok(
  $$select public.admin_platform_summary()$$,
  'Academic with view_analytics can call admin_platform_summary'
);

select test_helpers.as_runner();
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'can_admin_select_profiles',
        'can_admin_select_enrollments',
        'can_admin_select_attempts',
        'can_admin_select_attempt_detail',
        'can_admin_select_audit_logs',
        'test_leaderboard',
        'get_attempt_review'
      )
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%public%'
      )
  ),
  7,
  'F1 DEFINER helpers/RPCs set search_path = public'
);

select * from finish();
rollback;
