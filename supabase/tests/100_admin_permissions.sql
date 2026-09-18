-- Granular admin permissions (Step 8C). Transaction-scoped fixtures.
begin;
select plan(52);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Perm Student') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'Perm Student B') as id
  into temp t_student_b;
select test_helpers.make_admin('Perm Main Admin') as id into temp t_main;
select test_helpers.make_limited_admin('Perm Zero', '{}') as id into temp t_zero;
select test_helpers.make_limited_admin('Perm Academic', array['edit_questions']) as id
  into temp t_academic;
select test_helpers.make_limited_admin('Perm Year', array['manage_year_changes']) as id
  into temp t_year;
select test_helpers.make_limited_admin('Perm Admins', array['manage_admins']) as id
  into temp t_mgr;
select test_helpers.make_limited_admin('Perm Activate', array['activate_students']) as id
  into temp t_activate;
select test_helpers.make_limited_admin('Perm Restrict', array['restrict_students']) as id
  into temp t_restrict;
select test_helpers.make_limited_admin('Perm Grant', array['grant_resource_access']) as id
  into temp t_grantor;

grant select on curriculum, t_student, t_student_b, t_main, t_zero, t_academic,
  t_year, t_mgr, t_activate, t_restrict, t_grantor to anon, authenticated;

------------------------------------------------------------------
-- 1) Seeded catalog
------------------------------------------------------------------
select is(
  (select count(*)::int from public.permissions),
  16,
  'all approved permission codes are seeded'
);

------------------------------------------------------------------
-- 2) Main Admin has every permission with zero rows
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select is(
  (select count(*)::int from public.admin_permissions where admin_id = (select id from t_main)),
  0,
  'Main Admin has no admin_permissions rows'
);
select is(
  (select bool_and(public.has_permission(code)) from public.permissions),
  true,
  'Main Admin has every seeded permission'
);

------------------------------------------------------------------
-- 3) Normal admin without a permission is denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select ok(
  (not public.has_permission('edit_questions')),
  'admin with no rows is denied edit_questions'
);
select throws_ok(
  format(
    'select public.create_question(%L, ''Zero stem'', ''[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]''::jsonb, ''A'')',
    (select topic_id from curriculum)
  ),
  'permission_denied',
  'admin without edit_questions cannot create_question'
);
select throws_ok(
  format('select public.promote_student(%L)', (select id from t_student)),
  'permission_denied',
  'admin without manage_year_changes cannot promote_student'
);

------------------------------------------------------------------
-- 4) Normal admin with a permission is allowed
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select ok(
  public.has_permission('edit_questions'),
  'academic admin has edit_questions'
);
select lives_ok(
  format(
    'select public.create_question(%L, ''Academic stem '', ''[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]''::jsonb, ''A'')',
    (select topic_id from curriculum)
  ),
  'academic admin can create_question'
);
select throws_ok(
  format('select public.promote_student(%L)', (select id from t_student)),
  'permission_denied',
  'academic/MCQ codes do not grant year-change RPCs'
);

------------------------------------------------------------------
-- 5) Student cannot use admin permissions
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  (not public.has_permission('edit_questions')),
  'student has_permission is false'
);
select throws_ok(
  format(
    'select public.create_question(%L, ''Student stem'', ''[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]''::jsonb, ''A'')',
    (select topic_id from curriculum)
  ),
  'admin only',
  'student create_question still raises admin only'
);
select throws_ok(
  format('select public.grant_admin_permission(%L, ''edit_questions'')', (select id from t_student)),
  'admin only',
  'student cannot grant admin permissions'
);

------------------------------------------------------------------
-- 6) Student cannot modify own admin/role fields
------------------------------------------------------------------
select throws_ok(
  format('update public.profiles set role = ''admin'' where id = %L', (select id from t_student)),
  'role changes require admin',
  'student cannot self-promote role'
);
select throws_ok(
  format('update public.profiles set is_main_admin = true where id = %L', (select id from t_student)),
  'is_main_admin changes require admin',
  'student cannot set is_main_admin'
);
select throws_ok(
  format(
    'insert into public.admin_permissions (admin_id, permission_code) values (%L, ''edit_questions'')',
    (select id from t_main)
  ),
  'new row violates row-level security policy for table "admin_permissions"',
  'student cannot insert admin_permissions'
);
select throws_ok(
  'insert into public.permissions (code, label) values (''invented_code'', ''nope'')',
  'new row violates row-level security policy for table "permissions"',
  'student cannot insert permission catalog rows'
);

------------------------------------------------------------------
-- 7–8) Self-grant blocked; only manage_admins can modify rows
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'insert into public.admin_permissions (admin_id, permission_code) values (%L, ''manage_admins'')',
    (select id from t_academic)
  ),
  'new row violates row-level security policy for table "admin_permissions"',
  'admin cannot grant themselves a permission via direct insert'
);
select throws_ok(
  format('select public.grant_admin_permission(%L, ''manage_admins'')', (select id from t_academic)),
  'permission_denied',
  'admin without manage_admins cannot call grant_admin_permission'
);

select test_helpers.as_user((select id from t_mgr));
select lives_ok(
  format('select public.grant_admin_permission(%L, ''view_students'')', (select id from t_academic)),
  'manage_admins can grant a permission to another admin'
);

------------------------------------------------------------------
-- 9) Final Main Admin cannot be demoted/removed
------------------------------------------------------------------
select test_helpers.as_runner();
update public.profiles
set is_main_admin = false
where role = 'admin'
  and id <> (select id from t_main);
select test_helpers.as_user((select id from t_main));
select throws_ok(
  format('select public.set_main_admin(%L, false)', (select id from t_main)),
  'cannot demote the last Main Admin',
  'final Main Admin cannot clear is_main_admin'
);
select throws_ok(
  format('select public.set_admin_role(%L, false)', (select id from t_main)),
  'cannot demote the last Main Admin',
  'final Main Admin cannot demote themselves to student'
);

------------------------------------------------------------------
-- 10) Main Admin can manage other admins
------------------------------------------------------------------
select lives_ok(
  format('select public.set_admin_role(%L, true)', (select id from t_student_b)),
  'Main Admin can promote a student to admin'
);
select lives_ok(
  format('select public.grant_admin_permission(%L, ''view_analytics'')', (select id from t_student_b)),
  'Main Admin can grant permissions to another admin'
);
select lives_ok(
  format('select public.set_main_admin(%L, true)', (select id from t_student_b)),
  'Main Admin can grant Main Admin to another admin'
);
select lives_ok(
  format('select public.set_main_admin(%L, false)', (select id from t_student_b)),
  'Main Admin can demote another Main Admin when one remains'
);

------------------------------------------------------------------
-- 11) Existing legitimate admin actions still work where permission exists
------------------------------------------------------------------
select test_helpers.as_user((select id from t_year));
select lives_ok(
  format('select public.promote_student(%L)', (select id from t_student)),
  'admin with manage_year_changes can promote_student'
);

select test_helpers.as_user((select id from t_activate));
select throws_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'restricted'),
  'permission_denied',
  'activate_students cannot restrict'
);
select test_helpers.as_user((select id from t_restrict));
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'restricted'),
  'restrict_students can set restricted'
);
select throws_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'active'),
  'permission_denied',
  'restrict_students cannot restore to active'
);
select test_helpers.as_user((select id from t_activate));
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'active'),
  'activate_students can restore to active'
);

------------------------------------------------------------------
-- 12) Existing student RLS remains unchanged
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.profiles where id = (select id from t_student_b)),
  0,
  'student still cannot select another profile'
);
select throws_ok(
  format(
    'insert into public.questions (topic_id, status, difficulty) values (%L, ''draft'', ''easy'')',
    (select topic_id from curriculum)
  ),
  'new row violates row-level security policy for table "questions"',
  'student still cannot insert questions'
);

------------------------------------------------------------------
-- 13) Sensitive direct table writes no longer bypass permission checks
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select throws_ok(
  format(
    'insert into public.enrollments (student_id, year_id, status) values (%L, %L, ''active'')',
    (select id from t_zero),
    (select year_id from curriculum)
  ),
  'new row violates row-level security policy for table "enrollments"',
  'admin cannot insert enrollments directly'
);
select throws_ok(
  format(
    'insert into public.access_grants (student_id, grant_type, subject_id) values (%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'new row violates row-level security policy for table "access_grants"',
  'admin cannot insert access_grants directly'
);
select test_helpers.as_user((select id from t_zero));
update public.profiles
set account_status = 'restricted'
where id = (select id from t_student);
select test_helpers.as_runner();
select is(
  (select account_status from public.profiles where id = (select id from t_student)),
  'active',
  'admin without manage_students cannot UPDATE another profile status (0 rows)'
);

select test_helpers.make_limited_admin('Perm Profile', array['manage_students']) as id
  into temp t_editor;
grant select on t_editor to authenticated;
select test_helpers.as_user((select id from t_editor));
select throws_ok(
  format(
    'update public.profiles set account_status = ''restricted'' where id = %L',
    (select id from t_student)
  ),
  'account_status changes require set_account_status()',
  'manage_students still cannot bypass set_account_status() for account_status'
);
select throws_ok(
  format(
    'insert into public.tests (title, year_id, status) values (''x'', %L, ''draft'')',
    (select year_id from curriculum)
  ),
  'new row violates row-level security policy for table "tests"',
  'admin without publish_tests cannot insert tests'
);
select throws_ok(
  format(
    'insert into public.questions (topic_id, status, difficulty, content_hash, stem_normalized) values (%L, ''draft'', ''easy'', gen_random_uuid()::text, ''x'')',
    (select topic_id from curriculum)
  ),
  'new row violates row-level security policy for table "questions"',
  'admin without edit_questions cannot insert questions directly'
);

select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'insert into public.enrollments (student_id, year_id, status) values (%L, %L, ''expired'')',
    (select id from t_academic),
    (select year_id from curriculum)
  ),
  'new row violates row-level security policy for table "enrollments"',
  'edit_questions does not allow enrollment writes'
);

------------------------------------------------------------------
-- 14) SECURITY DEFINER functions use a controlled search_path
------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'has_permission', 'require_permission',
        'grant_admin_permission', 'revoke_admin_permission',
        'set_admin_role', 'set_main_admin',
        'grant_access', 'revoke_access'
      )
      and p.prosecdef
      and exists (
        select 1 from unnest(p.proconfig) cfg
        where cfg like 'search_path=%public%'
      )
  ),
  8,
  'new permission SECURITY DEFINER functions set search_path = public'
);

------------------------------------------------------------------
-- 15) Permission changes are audited
------------------------------------------------------------------
select test_helpers.as_runner();
select is(
  (
    select count(*)::int from public.audit_logs
    where action = 'admin_permission_granted'
      and target_id = (select id from t_academic)
      and details ->> 'code' = 'view_students'
  ) > 0,
  true,
  'grant_admin_permission writes an audit row'
);

select test_helpers.as_user((select id from t_mgr));
select public.revoke_admin_permission((select id from t_academic), 'view_students');
select test_helpers.as_runner();
select is(
  (
    select count(*)::int from public.audit_logs
    where action = 'admin_permission_revoked'
      and target_id = (select id from t_academic)
      and details ->> 'code' = 'view_students'
  ) > 0,
  true,
  'revoke_admin_permission writes an audit row'
);

------------------------------------------------------------------
-- Curriculum: existing is_admin() writes preserved (pending owner decision)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select lives_ok(
  format(
    'insert into public.subjects (year_id, name) values (%L, %L)',
    (select year_id from curriculum),
    'PGTAP_curr_' || (select id from t_zero)::text
  ),
  'curriculum writes still allowed for any admin until a dedicated code exists'
);

------------------------------------------------------------------
-- grant_access RPC
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select throws_ok(
  format(
    'select public.grant_access(%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'permission_denied',
  'admin without grant_resource_access cannot grant_access'
);
select test_helpers.as_user((select id from t_grantor));
select lives_ok(
  format(
    'select public.grant_access(%L, ''practice_subject'', %L)',
    (select id from t_student),
    (select subject_id from curriculum)
  ),
  'admin with grant_resource_access can grant_access'
);

------------------------------------------------------------------
-- 16) first Main Admin bootstrap (dev/staging script path)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.bootstrap_first_main_admin()$$,
  'main_admin_exists',
  'bootstrap_first_main_admin refuses when a Main Admin already exists'
);

select test_helpers.as_runner();
set local session_replication_role = replica;
update public.profiles set is_main_admin = false where is_main_admin;
set local session_replication_role = origin;
select test_helpers.as_user((select id from t_student));
select lives_ok(
  $$select public.bootstrap_first_main_admin()$$,
  'bootstrap_first_main_admin promotes the caller when none exists'
);
select is(
  (select role from public.profiles where id = (select id from t_student)),
  'admin',
  'bootstrapped caller is role=admin'
);
select ok(
  (select is_main_admin from public.profiles where id = (select id from t_student)),
  'bootstrapped caller is Main Admin'
);
select test_helpers.as_user((select id from t_zero));
select throws_ok(
  $$select public.bootstrap_first_main_admin()$$,
  'main_admin_exists',
  'second caller cannot bootstrap after the first Main Admin exists'
);
select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'main_admin_bootstrapped'
      and target_id = (select id from t_student)
  ),
  'bootstrap_first_main_admin is audit-logged'
);
select ok(
  (
    select prosecdef and proconfig::text like '%search_path=public%'
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'bootstrap_first_main_admin'
  ),
  'bootstrap_first_main_admin is SECURITY DEFINER with search_path = public'
);

select * from finish();
rollback;
