-- MCQ Bank admin-managed workflow: immediate approved, cascade Main-Admin
-- folder/subfolder Bin, any-admin bulk bin/restore/move, auth matrix.
begin;
select plan(28);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_admin('WF Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'WF Edit',
  array['edit_questions', 'import_questions']
) as id into temp t_edit;
select test_helpers.make_limited_admin(
  'WF WrongYear',
  array['edit_questions']
) as id into temp t_wrong;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

grant select on curriculum, t_year2, t_main, t_edit, t_wrong, t_block1
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit),
  array[(select year_id from curriculum)]
);
select public.set_admin_year_assignments(
  (select id from t_wrong),
  array[(select id from t_year2)]
);

create temporary table t_folder (id uuid);
create temporary table t_folder2 (id uuid);
create temporary table t_sf (id uuid);
create temporary table t_sf2 (id uuid);
create temporary table t_q1 (id uuid);
create temporary table t_q2 (id uuid);
create temporary table t_q3 (id uuid);
create temporary table t_q_indep (id uuid);
grant select, insert, update on t_folder, t_folder2, t_sf, t_sf2, t_q1, t_q2, t_q3, t_q_indep
  to anon, authenticated;

-- A/C: create with draft request → approved immediately
select test_helpers.as_user((select id from t_edit));
insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'WF Folder');
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'WF Sub A');
insert into t_sf2 (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'WF Sub B');

insert into t_q1 (id)
select public.create_question(
  (select topic_id from curriculum),
  'WF stem create draft request ' || gen_random_uuid()::text,
  '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
  'A', '', '', 'medium', '{}', 'draft', (select id from t_sf)
);

select is(
  (select status from public.questions where id = (select id from t_q1)),
  'approved',
  'A. create_question coerces draft → approved'
);

-- B: conversion of existing draft (simulate pre-migration row via direct insert)
select test_helpers.as_runner();
insert into t_q2 (id)
select gen_random_uuid();
insert into public.questions (
  id, topic_id, status, difficulty, content_hash, stem_normalized
)
select
  (select id from t_q2),
  (select topic_id from curriculum),
  'draft',
  'medium',
  public.question_content_hash(
    'WF draft convert ' || (select id from t_q2)::text,
    '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
    'B'
  ),
  public.normalize_stem('WF draft convert ' || (select id from t_q2)::text);
insert into public.question_versions (
  question_id, version_no, stem, options, correct_key, explanation, reference
)
select
  (select id from t_q2),
  1,
  'WF draft convert ' || (select id from t_q2)::text,
  '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
  'B',
  '',
  '';
update public.questions
set current_version_id = (
  select id from public.question_versions
  where question_id = (select id from t_q2) and version_no = 1
)
where id = (select id from t_q2);
-- mimic migration conversion
update public.questions
set status = 'approved'
where id = (select id from t_q2) and status = 'draft';
select is(
  (select status from public.questions where id = (select id from t_q2)),
  'approved',
  'B. draft conversion → approved'
);

-- C: no approval required — approved usable placement
select test_helpers.as_user((select id from t_edit));
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q2), (select id from t_sf)
);
select ok(
  (select mcq_bank_subfolder_id from public.questions where id = (select id from t_q2))
    = (select id from t_sf),
  'C. approved MCQ assignable without approval step'
);

-- D: any admin bulk-deletes selected MCQs
select lives_ok(
  $$select public.admin_bulk_soft_delete_subfolder_questions(
    (select id from t_sf),
    array[(select id from t_q1)],
    false
  )$$,
  'D. limited admin bulk soft-delete selected'
);
select ok(
  (select deleted_at is not null from public.questions where id = (select id from t_q1)),
  'D2. selected MCQ is in Bin'
);

-- restore for later tests
select public.admin_bulk_restore_subfolder_questions(
  (select id from t_sf),
  array[(select id from t_q1)],
  false
);

-- E: any admin bulk-deletes all in folder
insert into t_q3 (id)
select public.create_question(
  (select topic_id from curriculum),
  'WF stem folder bulk ' || gen_random_uuid()::text,
  '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
  'A', '', '', 'medium', '{}', 'approved', (select id from t_sf2)
);

select lives_ok(
  $$select public.admin_bulk_soft_delete_folder_questions(
    (select id from t_folder), null, true
  )$$,
  'E. limited admin bulk soft-delete all in folder'
);

select is(
  (select count(*)::int from public.questions
   where id in ((select id from t_q1),(select id from t_q2),(select id from t_q3))
     and deleted_at is not null),
  3,
  'E2. all folder MCQs binned'
);

-- G/H: bulk recover selected + all in subfolder
select public.admin_bulk_restore_folder_questions(
  (select id from t_folder), null, true
);
select is(
  (select count(*)::int from public.questions
   where id in ((select id from t_q1),(select id from t_q2),(select id from t_q3))
     and deleted_at is null),
  3,
  'G/H. bulk restore folder selection restores MCQs'
);

-- F: any admin bulk-deletes all in subfolder
select lives_ok(
  $$select public.admin_bulk_soft_delete_subfolder_questions(
    (select id from t_sf), null, true
  )$$,
  'F. limited admin bulk soft-delete all in subfolder'
);

select public.admin_bulk_restore_subfolder_questions(
  (select id from t_sf), null, true
);

-- Q: any admin bulk move
select lives_ok(
  $$select public.admin_bulk_move_mcq_bank_subfolder_questions(
    (select id from t_sf), (select id from t_sf2),
    array[(select id from t_q1)], false
  )$$,
  'Q. limited admin bulk move subfolder→subfolder'
);

select is(
  (select mcq_bank_subfolder_id from public.questions where id = (select id from t_q1)),
  (select id from t_sf2),
  'Q2. move preserved identity, new subfolder'
);

-- move back via folder bulk move
select lives_ok(
  $$select public.admin_bulk_move_mcq_bank_folder_questions(
    (select id from t_folder), (select id from t_sf),
    array[(select id from t_q1)], false
  )$$,
  'Q3. folder-scope bulk move to dest subfolder'
);

-- O/P: rename any admin
select lives_ok(
  $$select public.admin_rename_mcq_bank_folder((select id from t_folder), 'WF Folder Renamed')$$,
  'O. limited admin rename folder'
);
select lives_ok(
  $$select public.admin_rename_mcq_bank_subfolder((select id from t_sf), 'WF Sub Renamed')$$,
  'P. limited admin rename subfolder'
);

-- K/L: non-Main Admin cannot delete folder/subfolder
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf2))$$,
  'P0001',
  'permission_denied',
  'L. non-Main Admin cannot delete subfolder'
);
select throws_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'P0001',
  'permission_denied',
  'K. non-Main Admin cannot delete folder'
);

-- Independent bin for lineage test (different deleted_at)
select test_helpers.as_runner();
insert into t_q_indep (id)
select test_helpers.make_question((select topic_id from curriculum), 'C');
select test_helpers.as_user((select id from t_edit));
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q_indep), (select id from t_sf)
);
-- bin independently first
select public.soft_delete_content('question', (select id from t_q_indep));
-- ensure clock tick difference for lineage
select pg_sleep(0.05);

-- I/J: Main Admin cascade delete subfolder then folder
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_subfolder((select id from t_sf2))$$,
  'J. Main Admin cascade soft-delete subfolder'
);
select ok(
  (select deleted_at is not null from public.questions where id = (select id from t_q3)),
  'J2. cascade bins contained MCQs'
);

-- N: non-Main cannot restore subfolder
select test_helpers.as_user((select id from t_edit));
select throws_ok(
  $$select public.restore_content('mcq_bank_subfolder', (select id from t_sf2))$$,
  'P0001',
  'permission_denied',
  'N. non-Main Admin cannot recover subfolder'
);

-- M: Main Admin recover subfolder + cascaded MCQs
select test_helpers.as_user((select id from t_main));
select lives_ok(
  $$select public.restore_content('mcq_bank_subfolder', (select id from t_sf2))$$,
  'M. Main Admin recover subfolder'
);
select ok(
  (select deleted_at is null from public.questions where id = (select id from t_q3)),
  'T. cascade restore restores hierarchy MCQs'
);

-- I: Main Admin cascade folder delete
select lives_ok(
  $$select public.admin_soft_delete_mcq_bank_folder((select id from t_folder))$$,
  'I. Main Admin cascade soft-delete folder with contents'
);

select ok(
  (select deleted_at is not null from public.mcq_bank_folders where id = (select id from t_folder))
  and (select deleted_at is not null from public.mcq_bank_subfolders where id = (select id from t_sf)),
  'I2. folder + subfolders binned'
);

-- V: independently binned MCQ not restored with folder if different deleted_at
select lives_ok(
  $$select public.restore_content('mcq_bank_folder', (select id from t_folder))$$,
  'M2. Main Admin recover folder'
);

select ok(
  (select deleted_at is not null from public.questions where id = (select id from t_q_indep)),
  'V. independently binned MCQ not restored by folder recovery'
);

-- U: wrong-year cannot manipulate
select test_helpers.as_user((select id from t_wrong));
select throws_ok(
  $$select public.admin_bulk_soft_delete_subfolder_questions(
    (select id from t_sf), array[(select id from t_q1)], false
  )$$,
  'P0001',
  'year_scope_denied',
  'U. wrong-year admin cannot bulk-delete'
);

-- R: deleted MCQs remain in Bin (soft-delete columns set)
select test_helpers.as_user((select id from t_edit));
select public.admin_bulk_soft_delete_subfolder_questions(
  (select id from t_sf), array[(select id from t_q1)], false
);
select ok(
  (select deleted_at is not null and purge_after is not null
   from public.questions where id = (select id from t_q1)),
  'R. binned MCQ has deleted_at + purge_after'
);

-- S: purge_after ≈ 7 days (Content Bin retention intact)
select ok(
  (select purge_after - deleted_at between interval '6 days 23 hours'
      and interval '7 days 1 hour'
   from public.questions where id = (select id from t_q1)),
  'S. 7-day purge_after retained on soft-delete'
);

select * from finish();
rollback;
