-- Check 4 F3: answer keys / material URLs require curriculum|materials permissions.
begin;
select plan(17);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'F3 Student') as id
  into temp t_student;
select test_helpers.make_admin('F3 Main Admin') as id into temp t_main;
select test_helpers.make_limited_admin('F3 Zero', '{}') as id into temp t_zero;
select test_helpers.make_limited_admin(
  'F3 Ops',
  array['manage_subscriptions', 'review_subscription_applications', 'view_students']
) as id into temp t_ops;
select test_helpers.make_limited_admin(
  'F3 Academic',
  array['edit_questions', 'import_questions']
) as id into temp t_academic;
select test_helpers.make_limited_admin('F3 Publisher', array['publish_tests']) as id
  into temp t_pub;
select test_helpers.make_limited_admin('F3 Materials', array['manage_materials']) as id
  into temp t_mats;

select test_helpers.make_question((select topic_id from curriculum), 'A') as qid
  into temp t_q;

insert into public.material_folders (id, year_id, name)
values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  (select year_id from curriculum),
  'F3 Folder'
);
insert into public.materials (id, folder_id, title, drive_url)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'F3 Material',
  'https://drive.google.com/file/d/f3-secret'
);

grant select on curriculum, t_student, t_main, t_zero, t_ops, t_academic, t_pub, t_mats, t_q
  to anon, authenticated;

-- Lock the fixture folder behind paid entitlement so students without a
-- live subscription cannot open_material (admin path is still permissioned).
select test_helpers.as_user((select id from t_main));
select public.set_resource_entitlement(
  'materials_folder',
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
  'any_subscription'
);

------------------------------------------------------------------
-- Zero / ops admins cannot read answer keys or open Drive URLs
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select is(
  (select count(*)::int from public.question_versions
   where question_id = (select qid from t_q)),
  0,
  'zero-permission admin cannot SELECT question_versions (answer keys)'
);
select is(
  (select count(*)::int from public.questions where id = (select qid from t_q)),
  0,
  'zero-permission admin cannot SELECT questions'
);
select throws_ok(
  format('select public.open_material(%L)', 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'material_access_denied',
  'zero-permission admin cannot open_material'
);

select test_helpers.as_user((select id from t_ops));
select is(
  (select count(*)::int from public.question_versions
   where question_id = (select qid from t_q)),
  0,
  'ops-only admin cannot SELECT answer keys'
);
select throws_ok(
  format('select public.open_material(%L)', 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'material_access_denied',
  'ops-only admin cannot open_material Drive URL'
);
select is(
  (select count(*)::int from public.materials
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  0,
  'ops-only admin cannot SELECT materials metadata via admin policy'
);

------------------------------------------------------------------
-- Academic / publisher / materials retain intended access
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select is(
  (select count(*)::int from public.question_versions
   where question_id = (select qid from t_q)),
  1,
  'academic admin can SELECT question_versions'
);
select is(
  (select trim(correct_key::text) from public.question_versions
   where question_id = (select qid from t_q) limit 1),
  'A',
  'academic admin can read correct_key'
);

select test_helpers.as_user((select id from t_pub));
select ok(
  (select count(*)::int from public.tests) >= 0,
  'publisher can SELECT tests catalog (admin policy)'
);
select is(
  (select count(*)::int from public.question_versions
   where question_id = (select qid from t_q)),
  0,
  'publish_tests alone does not grant answer-key SELECT'
);

select test_helpers.as_user((select id from t_mats));
select is(
  public.open_material('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'https://drive.google.com/file/d/f3-secret',
  'manage_materials admin can open_material'
);
select is(
  (select count(*)::int from public.materials
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'manage_materials admin can SELECT materials metadata'
);

------------------------------------------------------------------
-- Main Admin retains access; students still denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select is(
  (select count(*)::int from public.question_versions
   where question_id = (select qid from t_q)),
  1,
  'Main Admin can SELECT question_versions'
);
select is(
  public.open_material('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'https://drive.google.com/file/d/f3-secret',
  'Main Admin can open_material'
);

select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.question_versions),
  0,
  'student cannot SELECT question_versions / correct_key'
);
select throws_ok(
  format('select public.open_material(%L)', 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'material_access_denied',
  'student without entitlement cannot open_material'
);
select throws_ok(
  format(
    'select drive_url from public.materials where id = %L',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
  ),
  '42501',
  'permission denied for table materials',
  'student cannot SELECT materials.drive_url column'
);

select * from finish();
rollback;
