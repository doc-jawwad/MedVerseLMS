-- One-liners table: RLS matrix, create/update RPCs, bin lifecycle.

begin;
select plan(11);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'OL Student') as id
  into temp t_student;
select test_helpers.make_admin('OL Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('OL Manager', array['manage_materials']) as id
  into temp t_manager;

grant select on curriculum, t_student, t_admin, t_manager to anon, authenticated;

-- Enroll student
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select year_id from curriculum), 'active')
on conflict do nothing;

-- 1. Admin can create a one-liner via RPC
select test_helpers.as_user((select id from t_admin));
select public.create_one_liner(
  p_year_id => (select year_id from curriculum),
  p_subject_id => (select subject_id from curriculum),
  p_title => 'OL Test liner',
  p_body => 'Body text here',
  p_status => 'draft'
) into temp t_liner_id;
grant select on t_liner_id to anon, authenticated;

select ok(
  (select id is not null from public.one_liners where id = (select column1 from t_liner_id limit 1)),
  '1. admin can create one-liner via RPC'
);

-- 2. Manager with manage_materials can create
select test_helpers.as_user((select id from t_manager));
select is_empty(
  $$ select public.create_one_liner(
    p_year_id => (select year_id from curriculum),
    p_subject_id => (select subject_id from curriculum),
    p_title => 'OL Manager liner',
    p_body => 'Manager body',
    p_status => 'draft'
  ) $$,
  '2. manager can call create_one_liner (no exception)'
);

-- 3. Student cannot call create_one_liner
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$ select public.create_one_liner(
    p_year_id => (select year_id from curriculum),
    p_subject_id => (select subject_id from curriculum),
    p_title => 'hack',
    p_body => 'hack body',
    p_status => 'draft'
  ) $$,
  'P0001',
  'permission_denied',
  '3. student cannot create one-liner'
);

-- 4. Anon cannot read one_liners directly
select test_helpers.as_anon();
select is(
  (select count(*)::int from public.one_liners),
  0,
  '4. anon sees 0 one_liners (RLS deny)'
);

-- 5. Student cannot see draft one-liners
select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.one_liners where id = (select column1 from t_liner_id limit 1)),
  0,
  '5. student cannot see draft one-liner'
);

-- 6. Admin can update one-liner
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format($$ select public.update_one_liner(
    p_id => %L,
    p_title => 'OL Updated',
    p_body => null,
    p_subject_id => null,
    p_status => 'published'
  ) $$, (select column1::text from t_liner_id limit 1)),
  '6. admin can update one-liner status to published'
);

-- 7. Published one-liner is visible to enrolled student
select test_helpers.as_user((select id from t_student));
select ok(
  (select count(*)::int from public.one_liners where id = (select column1 from t_liner_id limit 1)) = 1,
  '7. enrolled student can see published one-liner'
);

-- 8. Student cannot update one-liner directly
select throws_ok(
  format($$ update public.one_liners set title = 'hacked' where id = %L $$,
    (select column1::text from t_liner_id limit 1)),
  null,
  null,
  '8. student cannot update one-liner directly (RLS)'
);

-- 9. Admin can soft-delete via soft_delete_content
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format($$ select public.soft_delete_content('one_liner', %L) $$,
    (select column1::text from t_liner_id limit 1)),
  '9. soft_delete_content works for one_liner entity type'
);

-- 10. After soft-delete, deleted_at is set
select ok(
  (select deleted_at is not null from public.one_liners
   where id = (select column1 from t_liner_id limit 1)),
  '10. deleted_at set after soft delete'
);

-- 11. restore_content restores it
select lives_ok(
  format($$ select public.restore_content('one_liner', %L) $$,
    (select column1::text from t_liner_id limit 1)),
  '11. restore_content works for one_liner entity type'
);

select * from finish();
rollback;
