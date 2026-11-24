-- Issue 11: open-list groups / placements — RLS + admin RPCs.
-- Transaction-scoped fixtures; rolled back.

begin;
select plan(20);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('OL Main') as id into temp t_admin;
select test_helpers.make_limited_admin('OL NoPub', array['edit_questions']) as id
  into temp t_nopub;
select test_helpers.make_student((select year_id from curriculum), 'OL Student') as id
  into temp t_student;

-- Second year for cross-year denial.
select id as year_id into temp t_year2
from public.years where year_number = 2 limit 1;

grant select on curriculum, t_admin, t_nopub, t_student, t_year2 to authenticated;

------------------------------------------------------------------
-- Draft + published tests in year 1
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes,
    marks_per_question, negative_mark, min_questions, entitlement
  )
  values
    (
      'OL Open A',
      (select year_id from curriculum),
      'published',
      now() - interval '1 hour',
      now() + interval '2 days',
      60, 1, 0, 1, 'free'
    ),
    (
      'OL Open B',
      (select year_id from curriculum),
      'published',
      now() - interval '1 hour',
      now() + interval '3 days',
      60, 1, 0, 1, 'free'
    )
  returning id, title
)
select id, title into temp t_tests from ins;

insert into public.test_audiences (test_id, year_id)
select id, (select year_id from curriculum) from t_tests;

grant select on t_tests to authenticated;

------------------------------------------------------------------
-- 1–2) Student cannot create groups; limited admin without publish_tests cannot.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.admin_create_test_open_list_group(%L, %L)',
    (select year_id from curriculum),
    'Block Midterms'
  ),
  'permission_denied',
  'student cannot create open-list groups'
);

select test_helpers.as_user((select id from t_nopub));
select throws_ok(
  format(
    'select public.admin_create_test_open_list_group(%L, %L)',
    (select year_id from curriculum),
    'Block Midterms'
  ),
  'permission_denied',
  'edit_questions alone cannot create open-list groups'
);

------------------------------------------------------------------
-- 3–5) Main admin creates two groups, assigns, reorders placements
------------------------------------------------------------------
-- Create scratch tables as the runner; authenticated must not need CREATE
-- on the runner-owned pg_temp schema to exercise a public RPC.
select test_helpers.as_runner();
create temp table t_g1(id uuid);
create temp table t_g2(id uuid);
grant select, insert on t_g1, t_g2 to authenticated;
select test_helpers.as_user((select id from t_admin));
insert into t_g1
select public.admin_create_test_open_list_group(
  (select year_id from curriculum),
  'OL Group One ' || (select subject_id::text from curriculum)
);
insert into t_g2
select public.admin_create_test_open_list_group(
  (select year_id from curriculum),
  'OL Group Two ' || (select subject_id::text from curriculum)
);

select isnt(
  (select id from t_g1),
  null,
  'admin can create open-list group'
);

select lives_ok(
  format(
    'select public.admin_assign_test_open_list_placement(%L, %L)',
    (select id from t_tests where title = 'OL Open A'),
    (select id from t_g1)
  ),
  'admin can assign a test to a group'
);

select lives_ok(
  format(
    'select public.admin_reorder_test_open_list_placements(%L, %L, array[%L]::uuid[])',
    (select year_id from curriculum),
    (select id from t_g1),
    (select id from t_tests where title = 'OL Open A')
  ),
  'admin can reorder placements within a group'
);

------------------------------------------------------------------
-- 6) Cross-year assign refused
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.test_open_list_groups (year_id, name, sort_order)
  values ((select year_id from t_year2), 'OL Other ' || (select subject_id::text from curriculum), 0)
  returning id
)
select id into temp t_g_other from ins;
grant select on t_g_other to authenticated;

select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.admin_assign_test_open_list_placement(%L, %L)',
    (select id from t_tests where title = 'OL Open B'),
    (select id from t_g_other)
  ),
  'open_list_year_mismatch',
  'assign refuses cross-year group'
);

------------------------------------------------------------------
-- 7–8) Student can SELECT own-year groups/placements; cannot write tables
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.test_open_list_groups
   where id in ((select id from t_g1), (select id from t_g2))),
  2,
  'enrolled student can read open-list groups for their year'
);

select is(
  (select count(*)::int from public.test_open_list_groups where id=(select id from t_g_other)),
  0, 'student cannot read another class group'
);
select is(
  (select group_id from public.test_open_list_placements where test_id=(select id from t_tests where title='OL Open A')),
  (select id from t_g1), 'student sees assigned group placement'
);
select throws_ok(
  format(
    'insert into public.test_open_list_groups (year_id, name) values (%L, %L)',
    (select year_id from curriculum),
    'Hacked'
  ),
  'new row violates row-level security policy for table "test_open_list_groups"',
  'student cannot insert open-list groups directly'
);

------------------------------------------------------------------
-- 9–10) Delete group nulls placements (ungrouped fallback)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format('select public.admin_reorder_test_open_list_groups(%L, array[%L,%L]::uuid[])',
    (select year_id from curriculum),(select id from t_g2),(select id from t_g1)),
  'admin reorders two synthetic groups'
);
select is(
  (select array_agg(id order by sort_order) from public.test_open_list_groups
    where id in ((select id from t_g1),(select id from t_g2))),
  array[(select id from t_g2),(select id from t_g1)]::uuid[],
  'group order persisted'
);
select lives_ok(
  format('select public.admin_reorder_test_open_list_placements(%L,%L,array[%L,%L]::uuid[])',
    (select year_id from curriculum),(select id from t_g1),
    (select id from t_tests where title='OL Open B'),(select id from t_tests where title='OL Open A')),
  'admin reorders two synthetic tests in a group'
);
select lives_ok(
  format(
    'select public.admin_assign_test_open_list_placement(%L, %L)',
    (select id from t_tests where title = 'OL Open B'),
    (select id from t_g2)
  ),
  'assign second test to group two'
);

select lives_ok(
  format(
    'select public.admin_delete_test_open_list_group(%L)',
    (select id from t_g2)
  ),
  'admin can delete a group'
);

select is(
  (
    select group_id is null
    from public.test_open_list_placements
    where test_id = (select id from t_tests where title = 'OL Open B')
  ),
  true,
  'deleting a group leaves placement ungrouped (group_id null)'
);

------------------------------------------------------------------
-- 11–12) Reorder groups + rename
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.admin_reorder_test_open_list_groups(%L, array[%L]::uuid[])',
    (select year_id from curriculum),
    (select id from t_g1)
  ),
  'admin can reorder groups'
);

select lives_ok(
  format(
    'select public.admin_rename_test_open_list_group(%L, %L)',
    (select id from t_g1),
    'OL Renamed ' || (select subject_id::text from curriculum)
  ),
  'admin can rename a group'
);

------------------------------------------------------------------
-- 13–14) Ungroup assign (null group) + student cannot call reorder
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.admin_assign_test_open_list_placement(%L, null)',
    (select id from t_tests where title = 'OL Open A')
  ),
  'admin can move a test to ungrouped via null group_id'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.admin_reorder_test_open_list_groups(%L, array[%L]::uuid[])',
    (select year_id from curriculum),
    (select id from t_g1)
  ),
  'permission_denied',
  'student cannot reorder open-list groups'
);

select * from finish();
rollback;
