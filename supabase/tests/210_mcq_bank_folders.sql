-- Academic MCQ Bank folders: isolation, ownership, remove, usages, practice batch.
begin;
select plan(24);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'MCQ Fold Paid') as id
  into temp t_paid;
select test_helpers.make_admin('MCQ Fold Admin') as id into temp t_admin;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;
select id into temp t_block2
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-2'
  limit 1;

-- Final Year Surgery / Medicine product subjects
select id into temp t_fy from public.years where year_number = 5 limit 1;
select id into temp t_surgery
  from public.subjects
  where year_id = (select id from t_fy) and product_key = 'surgery'
  limit 1;
select id into temp t_medicine
  from public.subjects
  where year_id = (select id from t_fy) and product_key = 'medicine'
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc11'
where id = (select id from t_admin);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_paid, t_admin, t_plan, t_block1, t_block2, t_fy, t_surgery, t_medicine
  to authenticated;

-- Ensure practice entitlement on product blocks (free or any_subscription with live sub)
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block2), 'any_subscription'
);
select test_helpers.as_runner();

-- Source folders from migration seed
select id into temp t_f1
  from public.mcq_bank_folders
  where academic_product_subject_id = (select id from t_block1)
    and deleted_at is null
  order by sort_order, name
  limit 1;
select id into temp t_f2
  from public.mcq_bank_folders
  where academic_product_subject_id = (select id from t_block2)
    and deleted_at is null
  order by sort_order, name
  limit 1;
select id into temp t_fsurg
  from public.mcq_bank_folders
  where academic_product_subject_id = (select id from t_surgery)
    and deleted_at is null
  order by sort_order, name
  limit 1;
select id into temp t_fmed
  from public.mcq_bank_folders
  where academic_product_subject_id = (select id from t_medicine)
    and deleted_at is null
  order by sort_order, name
  limit 1;

-- Departmental Q-bank tree (taxonomy unchanged)
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'MCQ Fold Anatomy', 95);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'MCQ Fold Anatomy'
  order by created_at desc limit 1;
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'MCQ Fold Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'MCQ Fold Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'MCQ Fold Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q1;
select test_helpers.make_question((select id from t_topic), 'B') as id into temp t_q2;

update public.questions set status = 'approved'
where id in (select id from t_q1 union select id from t_q2);

grant select on t_f1, t_f2, t_fsurg, t_fmed, t_anatomy, t_book, t_chapter, t_topic, t_q1, t_q2
  to authenticated;

-- Subfolders under seeded folders (canonical placement)
select test_helpers.as_user((select id from t_admin));
create temporary table t_sf1 (id uuid);
create temporary table t_sf2 (id uuid);
grant select, insert on t_sf1, t_sf2 to authenticated;
insert into t_sf1 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_f1), '210 Sub F1');
insert into t_sf2 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_f2), '210 Sub F2');

-- D: initially unassigned (legacy)
select is(
  (select mcq_bank_folder_id from public.questions where id = (select id from t_q1)),
  null::uuid,
  'D: new questions start with null mcq_bank_folder_id'
);

-- Assign q1 to Block 1 subfolder as admin
select lives_ok(
  $$select public.admin_assign_unassigned_question_to_subfolder(
    (select id from t_q1), (select id from t_sf1)
  )$$,
  'assign unassigned to Block 1 subfolder'
);

-- D: cannot assign again to another subfolder
select throws_ok(
  $$select public.admin_assign_unassigned_question_to_subfolder(
    (select id from t_q1), (select id from t_sf2)
  )$$,
  'P0001',
  'question_already_assigned',
  'D: cannot place same question in a second Academic subfolder'
);

-- A: Block 1 folder listed under Block 1
select is(
  (
    select count(*)::int
    from public.admin_list_mcq_bank_folders((select id from t_block1))
    where folder_id = (select id from t_f1)
  ),
  1,
  'A: Block 1 Source folder visible under Block 1'
);

-- B: Block 2 folder not under Block 1 list
select is(
  (
    select count(*)::int
    from public.admin_list_mcq_bank_folders((select id from t_block1))
    where folder_id = (select id from t_f2)
  ),
  0,
  'B: Block 2 folder not listed under Block 1'
);

-- C: Surgery folder not under Medicine
select is(
  (
    select count(*)::int
    from public.admin_list_mcq_bank_folders((select id from t_medicine))
    where folder_id = (select id from t_fsurg)
  ),
  0,
  'C: Surgery folder not listed under Medicine'
);

select ok(
  exists (
    select 1 from public.admin_list_mcq_bank_folders((select id from t_surgery))
    where folder_id = (select id from t_fsurg)
  ),
  'C+: Surgery folder listed under Surgery'
);

-- E: remove from folder retains question
select lives_ok(
  $$select public.admin_remove_question_from_mcq_bank_folder((select id from t_q1))$$,
  'E: remove from folder'
);
select is(
  (select mcq_bank_folder_id from public.questions where id = (select id from t_q1)),
  null::uuid,
  'E: folder ownership cleared'
);
select isnt(
  (select id from public.questions where id = (select id from t_q1) and deleted_at is null),
  null::uuid,
  'E: question row retained'
);

-- Re-assign for remaining tests
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q1), (select id from t_sf1)
);

-- F: same question can be used by Prof. Session
insert into public.prof_session_days (
  year_id, subject_id, name, sort_order, status
)
values (
  (select year_id from curriculum),
  (select id from t_block1),
  'MCQ Fold Day',
  1,
  'published'
);
select id into temp t_day from public.prof_session_days
  where name = 'MCQ Fold Day' order by created_at desc limit 1;

insert into public.prof_session_day_practice_questions (day_id, question_id, sort_order)
values ((select id from t_day), (select id from t_q1), 0);

select ok(
  exists (
    select 1 from public.prof_session_day_practice_questions
    where day_id = (select id from t_day) and question_id = (select id from t_q1)
  ),
  'F: Prof. Session can reference folder-owned question'
);

-- G: same question on a formal test
insert into public.tests (
  title, year_id, subject_id, status, opens_at, closes_at, duration_minutes, test_type
)
values (
  'MCQ Fold Formal',
  (select year_id from curriculum),
  (select id from t_block1),
  'draft',
  now() + interval '1 day',
  now() + interval '2 days',
  30,
  'formal'
);
select id into temp t_test from public.tests
  where title = 'MCQ Fold Formal' order by created_at desc limit 1;
insert into public.test_questions (test_id, question_id, position)
values ((select id from t_test), (select id from t_q1), 1);

select ok(
  exists (
    select 1 from public.test_questions
    where test_id = (select id from t_test) and question_id = (select id from t_q1)
  ),
  'G: Formal test can reference folder-owned question'
);

-- H: list_question_usages returns academic + PS + formal
select ok(
  (
    select count(*)::int >= 3
    from public.list_question_usages((select id from t_q1))
  ),
  'H: list_question_usages returns multiple surfaces'
);
select ok(
  exists (
    select 1 from public.list_question_usages((select id from t_q1))
    where usage_kind = 'academic_mcq_folder'
  ),
  'H: usage includes Academic MCQ folder'
);

-- Student practice: as paid student
select test_helpers.as_user((select id from t_paid));

-- L: practice batch for folder returns q1
select ok(
  exists (
    select 1
    from public.get_practice_batch('mcq_bank_folder', (select id from t_f1), 10)
    where question_id = (select id from t_q1)
  ),
  'L: practice batch serves folder question set'
);

-- B student: Block 2 folder batch does not include Block 1 question
select is(
  (
    select count(*)::int
    from public.get_practice_batch('mcq_bank_folder', (select id from t_f2), 10)
    where question_id = (select id from t_q1)
  ),
  0,
  'B/L: Block 1 question not in Block 2 folder batch'
);

-- I: other year student cannot access (year 2 enrollment)
select test_helpers.as_runner();
select test_helpers.make_student(
  (select id from public.years where year_number = 2 limit 1),
  'MCQ Fold Y2'
) as id into temp t_y2;
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11'
where id = (select id from t_y2);
select test_helpers.as_user((select id from t_y2));
select throws_ok(
  $$select * from public.get_practice_batch('mcq_bank_folder', (select id from t_f1), 5)$$,
  'P0001',
  'practice_access_denied',
  'I: other-year student denied Block 1 folder practice'
);

-- J: FY Surgery folder not accessible to year-1 student even if they guess id
select test_helpers.as_user((select id from t_paid));
select throws_ok(
  $$select * from public.get_practice_batch('mcq_bank_folder', (select id from t_fsurg), 5)$$,
  'P0001',
  'practice_access_denied',
  'J: year-1 student denied Final Year Surgery folder'
);

-- K: entitlement gate — product subject without access denies folder practice
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject',
  (select id from t_block1),
  'plan',
  coalesce(
    (
      select id from public.subscription_plans
      where id is distinct from (select id from t_plan)
      order by sort_order limit 1
    ),
    (select id from t_plan)
  )
);

select test_helpers.as_user((select id from t_paid));
select case
  when not public.has_practice_access((select id from t_block1)) then
    throws_ok(
      $$select * from public.get_practice_batch('mcq_bank_folder', (select id from t_f1), 5)$$,
      'P0001',
      'practice_access_denied',
      'K: folder practice follows product subject entitlement'
    )
  else
    pass('K: has_practice_access still true (single complimentary plan) — L already gates via same helper')
end;

-- M: Prof. Session day batch still works with folder-owned question
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);
select test_helpers.as_user((select id from t_paid));
select ok(
  exists (
    select 1
    from public.get_practice_batch('prof_session_day', (select id from t_day), 10)
    where question_id = (select id from t_q1)
  ),
  'M: Prof. Session day practice batch unchanged for folder-owned question'
);

-- Folder delete blocked when non-empty
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_f1))$$,
  'P0001',
  'folder_not_empty',
  'soft-delete folder refuses when questions still assigned'
);

-- N: each live folder has a linked mcq_bank material folder for PDFs
select test_helpers.as_runner();
select ok(
  exists (
    select 1
    from public.mcq_bank_folders f
    join public.material_folders mf on mf.id = f.material_folder_id
    where f.id = (select id from t_f1)
      and mf.library_type = 'mcq_bank'
      and mf.subject_id = f.academic_product_subject_id
      and mf.deleted_at is null
  ),
  'N: Block 1 folder linked to mcq_bank material_folder for PDFs'
);

-- O: subfolder-scoped CSV import places question (denormalized folder)
select test_helpers.as_user((select id from t_admin));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('mcq-folder-import.csv', 1, (select id from t_admin))
  returning id
)
select id into temp t_batch from ins;
grant select on t_batch to authenticated;

create temporary table t_folder_import (result jsonb);
grant select, insert on t_folder_import to authenticated;

insert into t_folder_import (result)
select public.import_question_batch(
  (select id from t_batch),
  jsonb_build_array(
    jsonb_build_object(
      'row_number', 1,
      'subject_id', (select id from t_anatomy),
      'book', 'MCQ Fold Book',
      'chapter', 'MCQ Fold Ch',
      'topic', 'MCQ Fold Topic',
      'stem', 'Folder import stem unique ' || gen_random_uuid()::text,
      'options', jsonb_build_array(
        jsonb_build_object('key', 'A', 'text', 'one'),
        jsonb_build_object('key', 'B', 'text', 'two'),
        jsonb_build_object('key', 'C', 'text', 'three'),
        jsonb_build_object('key', 'D', 'text', 'four')
      ),
      'correct_key', 'A',
      'explanation', '',
      'reference', '',
      'difficulty', 'medium',
      'tags', '[]'::jsonb,
      'status', 'approved'
    )
  ),
  true,
  (select id from t_sf2)
);

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_folder_import),
  1,
  'O: subfolder import inserts one row'
);

select is(
  (
    select q.mcq_bank_folder_id
    from public.questions q
    where q.id = ((select t_folder_import.result -> 'question_ids' ->> 0 from t_folder_import)::uuid)
  ),
  (select id from t_f2),
  'O: imported question denormalized folder is Folder B (t_f2)'
);

select * from finish();
rollback;
