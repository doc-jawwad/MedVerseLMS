-- CSV taxonomy names: case-insensitive resolve + uniqueness.
-- Book/book/BOOK → one row; chapter/topic same; distinct names stay distinct.
-- Concurrent case variants are covered by tests/db/import-question-batch-concurrent.mjs.

begin;
select plan(18);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('CSV Case Admin A') as id into temp t_admin_a;
select test_helpers.make_admin('CSV Case Admin B') as id into temp t_admin_b;

grant select on curriculum, t_admin_a, t_admin_b to anon, authenticated;

create function pg_temp.csv_row(
  p_row int,
  p_stem text,
  p_book text,
  p_chapter text,
  p_topic text
) returns jsonb language sql as $$
  select jsonb_build_object(
    'row_number', p_row,
    'subject_id', (select subject_id from curriculum),
    'book', p_book,
    'chapter', p_chapter,
    'topic', p_topic,
    'stem', p_stem,
    'options', '[{"key":"A","text":"Opt A"},{"key":"B","text":"Opt B"},{"key":"C","text":"Opt C"},{"key":"D","text":"Opt D"}]'::jsonb,
    'correct_key', 'A',
    'explanation', 'because',
    'reference', 'ref',
    'difficulty', 'easy',
    'tags', '["csv-case"]'::jsonb,
    'status', 'approved'
  );
$$;

------------------------------------------------------------------
-- 1) Structural: CI unique indexes + ON CONFLICT (parent, lower(name))
------------------------------------------------------------------
select ok(
  (
    select count(*)::int = 3
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'books_subject_lower_name_uidx',
        'chapters_book_lower_name_uidx',
        'topics_chapter_lower_name_uidx'
      )
  ),
  'case-insensitive unique indexes exist on books/chapters/topics'
);

select ok(
  (
    select position('on conflict (subject_id, lower(name)) do nothing' in lower(prosrc)) > 0
      and position('on conflict (book_id, lower(name)) do nothing' in lower(prosrc)) > 0
      and position('on conflict (chapter_id, lower(name)) do nothing' in lower(prosrc)) > 0
      and position('questions_content_hash_unique' in lower(prosrc)) > 0
    from pg_proc
    where proname = 'import_question_batch'
      and pg_function_is_visible(oid)
  ),
  'import_question_batch ON CONFLICT uses lower(name)'
);

------------------------------------------------------------------
-- 2) Book then book → same taxonomy row; question ownership unchanged
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
select 'CaseBook-' || substr(gen_random_uuid()::text, 1, 8) as base into temp t_base;
grant select on t_base to authenticated;

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('case-book-a.csv', 1, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_book_a from ins;
grant select on t_batch_book_a to authenticated;

select public.import_question_batch(
  (select id from t_batch_book_a),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Case Book A ' || gen_random_uuid()::text,
      initcap((select base from t_base)),
      'CaseCh',
      'CaseTp'
    )
  ),
  true
) as result into temp t_book_a;
grant select on t_book_a to authenticated;

select test_helpers.as_user((select id from t_admin_b));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('case-book-b.csv', 1, (select id from t_admin_b))
  returning id
)
select id into temp t_batch_book_b from ins;
grant select on t_batch_book_b to authenticated;

select public.import_question_batch(
  (select id from t_batch_book_b),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Case Book B ' || gen_random_uuid()::text,
      lower((select base from t_base)),
      'casech',
      'casetp'
    )
  ),
  true
) as result into temp t_book_b;
grant select on t_book_b to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_book_a),
  1,
  'Book then book: first import inserts'
);
select is(
  (select (result ->> 'inserted')::int from t_book_b),
  1,
  'Book then book: second import inserts its own question'
);
select is(
  (
    select count(*)::int from public.books
    where subject_id = (select subject_id from curriculum)
      and lower(name) = lower((select base from t_base))
  ),
  1,
  'Book then book → same taxonomy row'
);
select is(
  (
    select count(*)::int from public.chapters c
    join public.books b on b.id = c.book_id
    where b.subject_id = (select subject_id from curriculum)
      and lower(b.name) = lower((select base from t_base))
      and lower(c.name) = 'casech'
  ),
  1,
  'chapter case variants resolve to one row'
);
select is(
  (
    select count(*)::int from public.topics t
    join public.chapters c on c.id = t.chapter_id
    join public.books b on b.id = c.book_id
    where b.subject_id = (select subject_id from curriculum)
      and lower(b.name) = lower((select base from t_base))
      and lower(c.name) = 'casech'
      and lower(t.name) = 'casetp'
  ),
  1,
  'topic case variants resolve to one row'
);
select is(
  (
    select q.created_by from public.questions q
    where q.id = ((select result -> 'question_ids' ->> 0 from t_book_a)::uuid)
  ),
  (select id from t_admin_a),
  'first importer keeps question created_by'
);
select is(
  (
    select q.created_by from public.questions q
    where q.id = ((select result -> 'question_ids' ->> 0 from t_book_b)::uuid)
  ),
  (select id from t_admin_b),
  'second importer keeps question created_by'
);
select is(
  (
    select created_by from public.import_batches
    where id = (select id from t_batch_book_a)
  ),
  (select id from t_admin_a),
  'batch A ownership unchanged'
);
select is(
  (
    select created_by from public.import_batches
    where id = (select id from t_batch_book_b)
  ),
  (select id from t_admin_b),
  'batch B ownership unchanged'
);

------------------------------------------------------------------
-- 3) book then BOOK → same row
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
select 'CaseFlip-' || substr(gen_random_uuid()::text, 1, 8) as base into temp t_flip;
grant select on t_flip to authenticated;

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('case-flip-a.csv', 1, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_flip_a from ins;
grant select on t_batch_flip_a to authenticated;

select public.import_question_batch(
  (select id from t_batch_flip_a),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Flip A ' || gen_random_uuid()::text,
      lower((select base from t_flip)),
      'flipch',
      'fliptp'
    )
  ),
  true
) as result into temp t_flip_a;
grant select on t_flip_a to authenticated;

select test_helpers.as_user((select id from t_admin_b));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('case-flip-b.csv', 1, (select id from t_admin_b))
  returning id
)
select id into temp t_batch_flip_b from ins;
grant select on t_batch_flip_b to authenticated;

select public.import_question_batch(
  (select id from t_batch_flip_b),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Flip B ' || gen_random_uuid()::text,
      upper((select base from t_flip)),
      'FLIPCH',
      'FLIPTP'
    )
  ),
  true
) as result into temp t_flip_b;
grant select on t_flip_b to authenticated;

select test_helpers.as_runner();
select is(
  (
    select count(*)::int from public.books
    where subject_id = (select subject_id from curriculum)
      and lower(name) = lower((select base from t_flip))
  ),
  1,
  'book then BOOK → same taxonomy row'
);
select is(
  (select (result ->> 'inserted')::int from t_flip_a)
    + (select (result ->> 'inserted')::int from t_flip_b),
  2,
  'book/BOOK pair still inserts two distinct questions'
);

------------------------------------------------------------------
-- 4) Different names remain distinct
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
select 'CaseDiff-' || substr(gen_random_uuid()::text, 1, 8) as prefix into temp t_diff;
grant select on t_diff to authenticated;

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('case-diff.csv', 2, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_diff from ins;
grant select on t_batch_diff to authenticated;

select public.import_question_batch(
  (select id from t_batch_diff),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Diff A ' || gen_random_uuid()::text,
      (select prefix from t_diff) || '-Alpha',
      'DiffChA',
      'DiffTpA'
    ),
    pg_temp.csv_row(
      3,
      'Diff B ' || gen_random_uuid()::text,
      (select prefix from t_diff) || '-Beta',
      'DiffChB',
      'DiffTpB'
    )
  ),
  true
) as result into temp t_diff_result;
grant select on t_diff_result to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_diff_result),
  2,
  'distinct taxonomy names still insert both questions'
);
select is(
  (
    select count(*)::int from public.books
    where subject_id = (select subject_id from curriculum)
      and name like (select prefix from t_diff) || '-%'
  ),
  2,
  'unrelated taxonomy names remain distinct rows'
);

------------------------------------------------------------------
-- 5) Normal exact-case reuse still works (regression)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('case-normal.csv', 1, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_normal from ins;
grant select on t_batch_normal to authenticated;

select public.import_question_batch(
  (select id from t_batch_normal),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Normal reuse ' || gen_random_uuid()::text,
      (select name from public.books where id = (select book_id from curriculum)),
      (select name from public.chapters where id = (select chapter_id from curriculum)),
      (select name from public.topics where id = (select topic_id from curriculum))
    )
  ),
  true
) as result into temp t_normal;
grant select on t_normal to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_normal),
  1,
  'existing exact-case taxonomy import unchanged'
);
select is(
  (
    select topic_id from public.questions
    where id = ((select result -> 'question_ids' ->> 0 from t_normal)::uuid)
  ),
  (select topic_id from curriculum),
  'normal import attaches to existing curriculum topic'
);

------------------------------------------------------------------
-- 6) Direct curriculum insert of case variant is rejected
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
create temp table t_case_reject (rejected boolean);
do $$
begin
  insert into public.books (subject_id, name)
  values (
    (select subject_id from curriculum),
    lower((select base from t_base))
  );
  insert into t_case_reject values (false);
exception
  when unique_violation then
    insert into t_case_reject values (true);
end;
$$;

select test_helpers.as_runner();
select ok(
  (select rejected from t_case_reject limit 1),
  'direct insert of case-variant book name is rejected'
);

select * from finish();
rollback;
