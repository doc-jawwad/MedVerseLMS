-- Main Admin escalation seal + curriculum / Prof Session permission gates.
begin;
select plan(20);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('RBAC Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'RBAC Custom',
  array['view_students', 'manage_materials', 'manage_admins']
) as id into temp t_custom;
select test_helpers.make_limited_admin(
  'RBAC Publish Only',
  array['publish_tests']
) as id into temp t_publish;
select test_helpers.make_limited_admin(
  'RBAC View Only',
  array['view_students']
) as id into temp t_view;
select test_helpers.make_limited_admin(
  'RBAC Curriculum',
  array['manage_curriculum']
) as id into temp t_curriculum;
select test_helpers.make_student((select year_id from curriculum), 'RBAC Student') as id
  into temp t_student;

-- Grant before any as_user() so authenticated can read fixture ids (VPS temp schema).
grant select on curriculum, t_main, t_custom, t_publish, t_view,
  t_curriculum, t_student to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_custom),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_publish),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_view),
  array[(select year_id from curriculum)]
);

select test_helpers.as_runner();
create temporary table t_test (id uuid);
create temporary table t_day (id uuid);
create temporary table t_block1 (id uuid);
grant select, insert on t_test, t_day, t_block1 to anon, authenticated;

insert into t_block1 (id)
select id
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

with ins as (
  insert into public.tests (title, year_id, status, duration_minutes, negative_mark, min_questions)
  values (
    'RBAC PS day bind',
    (select year_id from curriculum),
    'draft',
    30,
    0,
    1
  )
  returning id
)
insert into t_test (id) select id from ins;

with ins as (
  insert into public.prof_session_days (year_id, subject_id, name, sort_order, status)
  values (
    (select year_id from curriculum),
    (select id from t_block1),
    'RBAC day ' || gen_random_uuid()::text,
    99001,
    'draft'
  )
  returning id
)
insert into t_day (id) select id from ins;

------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select ok(
  public.has_permission('publish_tests'),
  'Main Admin has publish_tests without permission row'
);
select ok(
  public.has_permission('manage_curriculum'),
  'Main Admin has manage_curriculum without permission row'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_custom));
select ok(
  public.has_permission('manage_materials'),
  'custom admin has manage_materials'
);
select ok(
  not public.has_permission('manage_curriculum'),
  'custom admin lacks manage_curriculum'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  not public.has_permission('manage_materials'),
  'student lacks manage_materials'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_custom));
select throws_ok(
  format(
    'select public.set_main_admin(%L, true)',
    (select id from t_custom)
  ),
  'main_admin_required',
  'custom admin with manage_admins cannot become Main Admin via RPC'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.set_main_admin(%L, true)',
    (select id from t_student)
  ),
  'admin only',
  'student cannot become Main Admin via RPC'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_custom));
select throws_ok(
  format(
    'update public.profiles set is_main_admin = true where id = %L',
    (select id from t_custom)
  ),
  'main_admin_required',
  'custom admin cannot self-escalate via direct profiles UPDATE'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'update public.profiles set is_main_admin = true where id = %L',
    (select id from t_student)
  ),
  'is_main_admin changes require Main Admin',
  'student cannot set is_main_admin via direct UPDATE'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select lives_ok(
  format(
    'select public.set_main_admin(%L, true)',
    (select id from t_custom)
  ),
  'Main Admin can promote another admin to Main Admin'
);
select is(
  (select is_main_admin from public.profiles where id = (select id from t_custom)),
  true,
  'promoted admin is Main Admin'
);
select lives_ok(
  format(
    'select public.set_main_admin(%L, false)',
    (select id from t_custom)
  ),
  'Main Admin can demote a non-last Main Admin'
);
select is(
  (select is_main_admin from public.profiles where id = (select id from t_custom)),
  false,
  'demoted admin is no longer Main Admin'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_custom));
select throws_ok(
  format(
    'insert into public.subjects (year_id, name) values (%L, %L)',
    (select year_id from curriculum),
    'RBAC blocked subject'
  ),
  'new row violates row-level security policy for table "subjects"',
  'custom admin without manage_curriculum cannot insert subjects'
);

select test_helpers.as_user((select id from t_curriculum));
select lives_ok(
  format(
    'insert into public.subjects (year_id, name) values (%L, %L)',
    (select year_id from curriculum),
    'RBAC allowed subject ' || gen_random_uuid()::text
  ),
  'admin with manage_curriculum can insert subjects'
);

select test_helpers.as_user((select id from t_main));
select lives_ok(
  format(
    'insert into public.subjects (year_id, name) values (%L, %L)',
    (select year_id from curriculum),
    'RBAC main subject ' || gen_random_uuid()::text
  ),
  'Main Admin can insert subjects'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_view));
select throws_ok(
  format(
    'select public.admin_set_test_prof_session_day(%L, %L)',
    (select id from t_test),
    (select id from t_day)
  ),
  'permission_denied',
  'view_students alone cannot bind Prof Session day'
);

select test_helpers.as_user((select id from t_custom));
select lives_ok(
  format(
    'select public.admin_set_test_prof_session_day(%L, %L)',
    (select id from t_test),
    (select id from t_day)
  ),
  'manage_materials may bind Prof Session day'
);

select test_helpers.as_user((select id from t_publish));
select lives_ok(
  format(
    'select public.admin_set_test_prof_session_day(%L, null)',
    (select id from t_test)
  ),
  'publish_tests may clear Prof Session day bind'
);

------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  'select public.bootstrap_first_main_admin()',
  'main_admin_exists',
  'bootstrap refused while Main Admin exists'
);

select * from finish();
rollback;
