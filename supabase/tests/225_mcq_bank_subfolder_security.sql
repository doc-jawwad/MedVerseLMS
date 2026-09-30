-- Academic MCQ Bank subfolder security: year/entitlement gates + unauthorized admin.
begin;
select plan(16);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;

select test_helpers.make_student((select id from t_y1), 'Sub Sec Paid') as id
  into temp t_paid;
select test_helpers.make_student((select id from t_y2), 'Sub Sec Y2') as id
  into temp t_y2_stu;
select test_helpers.make_admin('Sub Sec Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Sub Sec Edit',
  array['edit_questions', 'import_questions']
) as id into temp t_edit;
select test_helpers.make_limited_admin(
  'Sub Sec WrongYear',
  array['edit_questions', 'import_questions']
) as id into temp t_wrong;
select test_helpers.make_limited_admin(
  'Sub Sec NoPerm',
  array['view_analytics']
) as id into temp t_noperm;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

select id into temp t_block1
  from public.subjects
  where year_id = (select id from t_y1) and product_key = 'block-1'
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa53'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb53'
where id = (select id from t_y2_stu);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc53'
where id = (select id from t_main);
update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-dddddddddd53'
where id = (select id from t_edit);
update public.profiles
set active_session_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee53'
where id = (select id from t_wrong);
update public.profiles
set active_session_id = 'ffffffff-ffff-ffff-ffff-ffffffffff53'
where id = (select id from t_noperm);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select id from t_y1),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_y1, t_y2, t_paid, t_y2_stu, t_main, t_edit, t_wrong, t_noperm,
  t_plan, t_block1
  to authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit),
  array[(select id from t_y1)]
);
select public.set_admin_year_assignments(
  (select id from t_wrong),
  array[(select id from t_y2)]
);
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select id from t_y1), 'Sub Sec Anatomy', 94);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select id from t_y1) and name = 'Sub Sec Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
select test_helpers.as_user((select id from t_main));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Sub Sec Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Sub Sec Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Sub Sec Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;
grant select on t_book, t_chapter, t_topic to authenticated;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q1;
update public.questions set status = 'approved' where id = (select id from t_q1);
select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q2;
update public.questions set status = 'approved' where id = (select id from t_q2);
grant select on t_q1, t_q2 to authenticated;

create temporary table t_q1_ver (id uuid);
grant select, insert on t_q1_ver to authenticated;
insert into t_q1_ver (id)
select current_version_id from public.questions where id = (select id from t_q1);

select test_helpers.as_user((select id from t_edit));
create temporary table t_folder (id uuid);
create temporary table t_sf (id uuid);
create temporary table t_sf2 (id uuid);
grant select, insert on t_folder, t_sf, t_sf2 to authenticated;

insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Sub Sec Folder');
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'Sub Sec A');
insert into t_sf2 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'Sub Sec B');

select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q1), (select id from t_sf)
);
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q2), (select id from t_sf)
);

grant select on t_folder, t_sf, t_sf2, t_q1_ver to authenticated;

------------------------------------------------------------------
-- Student: wrong year / unauthorized → practice_access_denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_y2_stu));
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_subfolder'', %L::uuid, 5)',
    (select id from t_sf)
  ),
  'P0001',
  'practice_access_denied',
  '1. other-year student denied subfolder practice'
);

select throws_ok(
  format(
    'select public.get_mcq_bank_subfolder_practice_progress(%L::uuid)',
    (select id from t_sf)
  ),
  'P0001',
  'practice_access_denied',
  '2. other-year student denied subfolder progress'
);

------------------------------------------------------------------
-- Unauthorized admin CSV / move
------------------------------------------------------------------
select test_helpers.as_user((select id from t_wrong));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sf),
    (select id from t_sf2),
    array[(select id from t_q1)],
    false
  )$$,
  'P0001',
  'year_scope_denied',
  '3. wrong-year admin cannot bulk move subfolder questions'
);

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('sub-sec-denied.csv', 1, (select id from t_wrong))
  returning id
)
select id into temp t_batch_denied from ins;
grant select on t_batch_denied to authenticated;

select throws_ok(
  format(
    $q$select public.import_question_batch(
      %L::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'row_number', 1,
          'subject_id', %L::uuid,
          'book', 'Sub Sec Book',
          'chapter', 'Sub Sec Ch',
          'topic', 'Sub Sec Topic',
          'stem', 'denied import ' || gen_random_uuid()::text,
          'options', jsonb_build_array(
            jsonb_build_object('key', 'A', 'text', 'one'),
            jsonb_build_object('key', 'B', 'text', 'two'),
            jsonb_build_object('key', 'C', 'text', 'three'),
            jsonb_build_object('key', 'D', 'text', 'four')
          ),
          'correct_key', 'A',
          'status', 'approved'
        )
      ),
      true,
      %L::uuid
    )$q$,
    (select id from t_batch_denied),
    (select id from t_anatomy),
    (select id from t_sf)
  ),
  'P0001',
  'year_scope_denied',
  '4. wrong-year admin cannot CSV-import into Y1 subfolder'
);

select test_helpers.as_user((select id from t_noperm));
select throws_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sf),
    (select id from t_sf2),
    array[(select id from t_q1)],
    false
  )$$,
  'P0001',
  'permission_denied',
  '5. admin without edit_questions cannot bulk move'
);

------------------------------------------------------------------
-- Entitlement expiry: Favorites/Incorrect are NOT entitlement
-- (same gate as normal practice — denied after expire)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_paid));
select ok(
  public.can_access_mcq_bank_subfolder_practice((select id from t_sf)),
  '6. paid student can access subfolder practice'
);

select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q1)
  ),
  '7. favorite while entitled'
);
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q1_ver)
  ),
  '8. wrong answer while entitled'
);

select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_subfolder_favorites', (select id from t_sf), 50
    ) where question_id = (select id from t_q1)
  ),
  '9. favorites practice returns marked MCQ while entitled'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_subfolder_incorrect', (select id from t_sf), 50
    ) where question_id = (select id from t_q1)
  ),
  '10. incorrect practice returns wrong MCQ while entitled'
);

select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where student_id = (select id from t_paid);

select test_helpers.as_user((select id from t_paid));
select ok(
  (
    select marked from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q1)
  ),
  '11. marked row persists after expire (historical)'
);
select ok(
  (
    select incorrect from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q1)
  ),
  '12. incorrect row persists after expire (historical)'
);
select ok(
  not public.can_access_mcq_bank_subfolder_practice((select id from t_sf)),
  '13. subfolder practice access denied after expire'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_subfolder_favorites'', %L::uuid, 5)',
    (select id from t_sf)
  ),
  'P0001',
  'practice_access_denied',
  '14. favorites practice denied after expire (not entitlement)'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_subfolder_incorrect'', %L::uuid, 5)',
    (select id from t_sf)
  ),
  'P0001',
  'practice_access_denied',
  '15. incorrect practice denied after expire (not entitlement)'
);
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_subfolder'', %L::uuid, 5)',
    (select id from t_sf)
  ),
  'P0001',
  'practice_access_denied',
  '16. normal subfolder practice also denied after expire'
);

select * from finish();
rollback;
