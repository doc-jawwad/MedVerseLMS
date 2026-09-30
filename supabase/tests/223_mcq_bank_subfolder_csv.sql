-- Academic MCQ Bank subfolder CSV import + legacy folder assign refusal.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id into temp t_year2 from public.years where year_number = 2 limit 1;

select test_helpers.make_limited_admin(
  'Sub CSV Edit',
  array['edit_questions', 'import_questions']
) as id into temp t_edit;
select test_helpers.make_admin('Sub CSV Main') as id into temp t_main;

select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;
select id into temp t_block_y2
  from public.subjects
  where year_id = (select id from t_year2) and product_key = 'block-4'
  limit 1;

grant select on curriculum, t_year2, t_edit, t_main, t_block1, t_block_y2
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_edit),
  array[(select year_id from curriculum), (select id from t_year2)]
);

-- Departmental taxonomy (year 1)
select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'Sub CSV Anatomy', 91);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'Sub CSV Anatomy'
  order by created_at desc limit 1;
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Sub CSV Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Sub CSV Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Sub CSV Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;

-- Year-2 taxonomy for mismatch
insert into public.subjects (year_id, name, sort_order)
values ((select id from t_year2), 'Sub CSV Anatomy Y2', 92);
select id into temp t_anatomy_y2
  from public.subjects
  where year_id = (select id from t_year2) and name = 'Sub CSV Anatomy Y2'
  order by created_at desc limit 1;
insert into public.books (subject_id, name)
values ((select id from t_anatomy_y2), 'Sub CSV Book Y2');
select id into temp t_book_y2 from public.books
  where subject_id = (select id from t_anatomy_y2) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book_y2), 'Sub CSV Ch Y2');
select id into temp t_chapter_y2 from public.chapters
  where book_id = (select id from t_book_y2) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter_y2), 'Sub CSV Topic Y2');
select id into temp t_topic_y2 from public.topics
  where chapter_id = (select id from t_chapter_y2) order by created_at desc limit 1;

grant select on t_anatomy, t_book, t_chapter, t_topic,
  t_anatomy_y2, t_book_y2, t_chapter_y2, t_topic_y2
  to anon, authenticated;

create temporary table t_folder (id uuid);
create temporary table t_sf (id uuid);
create temporary table t_sf_y2 (id uuid);
grant select, insert on t_folder, t_sf, t_sf_y2 to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Sub CSV Folder');
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder), 'Sub CSV Sub'
);

-- Y2 folder/subfolder for wrong-year import attempt against Y1 subject rows
create temporary table t_folder_y2 (id uuid);
grant select, insert on t_folder_y2 to anon, authenticated;
insert into t_folder_y2 (id)
select public.admin_create_mcq_bank_folder((select id from t_block_y2), 'Sub CSV Folder Y2');
insert into t_sf_y2 (id)
select public.admin_create_mcq_bank_subfolder(
  (select id from t_folder_y2), 'Sub CSV Sub Y2'
);

-- Valid import into subfolder
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('sub-csv-ok.csv', 1, (select id from t_edit))
  returning id
)
select id into temp t_batch from ins;
grant select on t_batch to anon, authenticated;

create temporary table t_import (result jsonb);
grant select, insert on t_import to anon, authenticated;

insert into t_import (result)
select public.import_question_batch(
  (select id from t_batch),
  jsonb_build_array(
    jsonb_build_object(
      'row_number', 1,
      'subject_id', (select id from t_anatomy),
      'book', 'Sub CSV Book',
      'chapter', 'Sub CSV Ch',
      'topic', 'Sub CSV Topic',
      'stem', 'Sub CSV stem unique ' || gen_random_uuid()::text,
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
  (select id from t_sf)
);

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_import),
  1,
  '1. valid subfolder import inserts one row'
);

select is(
  (
    select q.mcq_bank_subfolder_id
    from public.questions q
    where q.id = ((select t_import.result -> 'question_ids' ->> 0 from t_import)::uuid)
  ),
  (select id from t_sf),
  '2. imported question has mcq_bank_subfolder_id'
);

select is(
  (
    select q.mcq_bank_folder_id
    from public.questions q
    where q.id = ((select t_import.result -> 'question_ids' ->> 0 from t_import)::uuid)
  ),
  (select id from t_folder),
  '3. denormalized mcq_bank_folder_id matches parent folder'
);

-- client_errors → atomic reject (no partial insert)
select test_helpers.as_user((select id from t_edit));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('sub-csv-bad.csv', 1, (select id from t_edit))
  returning id
)
select id into temp t_batch_bad from ins;
grant select on t_batch_bad to anon, authenticated;

select throws_ok(
  format(
    $q$select public.import_question_batch(
      %L::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'row_number', 1,
          'subject_id', %L::uuid,
          'book', 'Sub CSV Book',
          'chapter', 'Sub CSV Ch',
          'topic', 'Sub CSV Topic',
          'stem', 'bad client errors stem ' || gen_random_uuid()::text,
          'options', jsonb_build_array(
            jsonb_build_object('key', 'A', 'text', 'one'),
            jsonb_build_object('key', 'B', 'text', 'two'),
            jsonb_build_object('key', 'C', 'text', 'three'),
            jsonb_build_object('key', 'D', 'text', 'four')
          ),
          'correct_key', 'A',
          'client_errors', jsonb_build_array('stem too short'),
          'status', 'approved'
        )
      ),
      true,
      %L::uuid
    )$q$,
    (select id from t_batch_bad),
    (select id from t_anatomy),
    (select id from t_sf)
  ),
  'P0001',
  'csv_validation_required: fix CSV errors before import',
  '4. client_errors reject entire batch atomically'
);

select is(
  (
    select count(*)::int
    from public.questions q
    where q.mcq_bank_subfolder_id = (select id from t_sf)
      and q.deleted_at is null
  ),
  1,
  '5. client_errors batch did not insert extra questions'
);

-- Wrong year: Y1 subject row into Y2 subfolder
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('sub-csv-year.csv', 1, (select id from t_edit))
  returning id
)
select id into temp t_batch_year from ins;
grant select on t_batch_year to anon, authenticated;

select throws_ok(
  format(
    $q$select public.import_question_batch(
      %L::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'row_number', 1,
          'subject_id', %L::uuid,
          'book', 'Sub CSV Book',
          'chapter', 'Sub CSV Ch',
          'topic', 'Sub CSV Topic',
          'stem', 'year mismatch stem ' || gen_random_uuid()::text,
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
    (select id from t_batch_year),
    (select id from t_anatomy),
    (select id from t_sf_y2)
  ),
  'P0001',
  'import row 1 failed: mcq_bank_subfolder_year_mismatch',
  '6. wrong-year taxonomy rejected for subfolder import'
);

-- Legacy folder assign RPC refused
select test_helpers.as_runner();
select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_legacy;
update public.questions set status = 'approved' where id = (select id from t_q_legacy);
grant select on t_q_legacy to anon, authenticated;

select test_helpers.as_user((select id from t_edit));
select throws_ok(
  $$select public.admin_assign_unassigned_question_to_folder(
    (select id from t_q_legacy), (select id from t_folder)
  )$$,
  'P0001',
  'mcq_bank_requires_subfolder',
  '7. legacy folder assign RPC raises mcq_bank_requires_subfolder'
);

select is(
  (select mcq_bank_folder_id from public.questions where id = (select id from t_q_legacy)),
  null::uuid,
  '8. legacy assign left question unplaced'
);

-- create_question with subfolder id works
select lives_ok(
  format(
    $q$select public.create_question(
      %L::uuid,
      'manual sub create ' || gen_random_uuid()::text,
      '[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"D"}]'::jsonb,
      'A',
      '',
      '',
      'medium',
      '{}',
      'approved',
      %L::uuid
    )$q$,
    (select id from t_topic),
    (select id from t_sf)
  ),
  '9. create_question 10th arg places into subfolder'
);

select is(
  (
    select count(*)::int
    from public.questions
    where mcq_bank_subfolder_id = (select id from t_sf)
      and deleted_at is null
  ),
  2,
  '10. create_question increased subfolder live count'
);

select * from finish();
rollback;
