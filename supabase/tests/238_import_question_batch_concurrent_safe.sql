-- import_question_batch: concurrent-safe taxonomy/content-hash handling.
-- Sequential duplicate + atomic rollback + structural race-safety checks.
-- True two-session races are covered by tests/db/import-question-batch-concurrent.mjs.

begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('CSV Conc Admin A') as id into temp t_admin_a;
select test_helpers.make_admin('CSV Conc Admin B') as id into temp t_admin_b;

grant select on curriculum, t_admin_a, t_admin_b to anon, authenticated;

create function pg_temp.csv_row(
  p_row int,
  p_stem text,
  p_book text default null,
  p_chapter text default null,
  p_topic text default null,
  p_correct char default 'A'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'row_number', p_row,
    'subject_id', (select subject_id from curriculum),
    'book', coalesce(p_book, (select name from public.books where id = (select book_id from curriculum))),
    'chapter', coalesce(p_chapter, (select name from public.chapters where id = (select chapter_id from curriculum))),
    'topic', coalesce(p_topic, (select name from public.topics where id = (select topic_id from curriculum))),
    'stem', p_stem,
    'options', '[{"key":"A","text":"Opt A"},{"key":"B","text":"Opt B"},{"key":"C","text":"Opt C"},{"key":"D","text":"Opt D"}]'::jsonb,
    'correct_key', p_correct,
    'explanation', 'because',
    'reference', 'ref',
    'difficulty', 'easy',
    'tags', '["csv-conc"]'::jsonb,
    'status', 'approved'
  );
$$;

------------------------------------------------------------------
-- 1) Structural: race-safe clauses present in RPC body
------------------------------------------------------------------
select ok(
  (
    select position('on conflict (subject_id, lower(name)) do nothing' in lower(prosrc)) > 0
      and position('on conflict (book_id, lower(name)) do nothing' in lower(prosrc)) > 0
      and position('on conflict (chapter_id, lower(name)) do nothing' in lower(prosrc)) > 0
      and position('questions_content_hash_unique' in lower(prosrc)) > 0
      and position('unique_violation' in lower(prosrc)) > 0
      and position('skipped_duplicate' in lower(prosrc)) > 0
    from pg_proc
    where proname = 'import_question_batch'
      and pg_function_is_visible(oid)
  ),
  'import_question_batch handles taxonomy ON CONFLICT and content_hash unique_violation'
);

------------------------------------------------------------------
-- 2) Sequential duplicate still skipped_duplicate
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('conc-seq-ok.csv', 1, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_ok from ins;
grant select on t_batch_ok to authenticated;

select public.import_question_batch(
  (select id from t_batch_ok),
  jsonb_build_array(pg_temp.csv_row(2, 'Conc seq stem ' || gen_random_uuid()::text)),
  true
) as result into temp t_ok_result;
grant select on t_ok_result to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_ok_result),
  1,
  'sequential import inserts one row'
);

select test_helpers.as_user((select id from t_admin_b));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('conc-seq-dup.csv', 1, (select id from t_admin_b))
  returning id
)
select id into temp t_batch_dup from ins;
grant select on t_batch_dup to authenticated;

select stem, options, correct_key into temp t_dup_src
from public.question_versions
where id = (
  select current_version_id from public.questions
  where id = ((select result -> 'question_ids' ->> 0 from t_ok_result)::uuid)
);
grant select on t_dup_src to authenticated;

select public.import_question_batch(
  (select id from t_batch_dup),
  jsonb_build_array(
    jsonb_build_object(
      'row_number', 2,
      'subject_id', (select subject_id from curriculum),
      'book', (select name from public.books where id = (select book_id from curriculum)),
      'chapter', (select name from public.chapters where id = (select chapter_id from curriculum)),
      'topic', (select name from public.topics where id = (select topic_id from curriculum)),
      'stem', (select stem from t_dup_src),
      'options', (select options from t_dup_src),
      'correct_key', (select correct_key from t_dup_src),
      'explanation', '',
      'reference', '',
      'difficulty', 'medium',
      'tags', '[]'::jsonb,
      'status', 'approved'
    )
  ),
  true
) as result into temp t_dup_result;
grant select on t_dup_result to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'skipped')::int from t_dup_result),
  1,
  'sequential duplicate still skipped'
);
select is(
  (select (result ->> 'inserted')::int from t_dup_result),
  0,
  'sequential duplicate does not insert'
);
select is(
  (select outcome from public.import_rows where batch_id = (select id from t_batch_dup)),
  'skipped_duplicate',
  'sequential duplicate outcome unchanged'
);

------------------------------------------------------------------
-- 3) create_missing reuses taxonomy created by the other admin (sequential)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('conc-tax-a.csv', 1, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_tax_a from ins;
grant select on t_batch_tax_a to authenticated;

select 'ConcTaxBook-' || gen_random_uuid()::text as name into temp t_shared_book;
grant select on t_shared_book to authenticated;

select public.import_question_batch(
  (select id from t_batch_tax_a),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Tax A stem ' || gen_random_uuid()::text,
      (select name from t_shared_book),
      'ConcTaxCh',
      'ConcTaxTp'
    )
  ),
  true
) as result into temp t_tax_a;
grant select on t_tax_a to authenticated;

select test_helpers.as_user((select id from t_admin_b));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('conc-tax-b.csv', 1, (select id from t_admin_b))
  returning id
)
select id into temp t_batch_tax_b from ins;
grant select on t_batch_tax_b to authenticated;

select public.import_question_batch(
  (select id from t_batch_tax_b),
  jsonb_build_array(
    pg_temp.csv_row(
      2,
      'Tax B stem ' || gen_random_uuid()::text,
      (select name from t_shared_book),
      'ConcTaxCh',
      'ConcTaxTp'
    )
  ),
  true
) as result into temp t_tax_b;
grant select on t_tax_b to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_tax_a),
  1,
  'admin A creates missing taxonomy + question'
);
select is(
  (select (result ->> 'inserted')::int from t_tax_b),
  1,
  'admin B reuses shared taxonomy and inserts own question'
);
select is(
  (
    select count(*)::int from public.books
    where subject_id = (select subject_id from curriculum)
      and name = (select name from t_shared_book)
  ),
  1,
  'exactly one shared book row for the shared taxonomy name'
);
select is(
  (
    select count(distinct q.created_by)::int
    from public.questions q
    where q.id in (
      (select result -> 'question_ids' ->> 0 from t_tax_a)::uuid,
      (select result -> 'question_ids' ->> 0 from t_tax_b)::uuid
    )
  ),
  2,
  'each importer owns their question created_by'
);
select is(
  (
    select q.created_by from public.questions q
    where q.id = ((select result -> 'question_ids' ->> 0 from t_tax_a)::uuid)
  ),
  (select id from t_admin_a),
  'admin A question created_by is A'
);
select is(
  (
    select q.created_by from public.questions q
    where q.id = ((select result -> 'question_ids' ->> 0 from t_tax_b)::uuid)
  ),
  (select id from t_admin_b),
  'admin B question created_by is B'
);

------------------------------------------------------------------
-- 4) Genuine error still rolls back the batch
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('conc-atomic.csv', 2, (select id from t_admin_a))
  returning id
)
select id into temp t_batch_atomic from ins;
grant select on t_batch_atomic to authenticated;

select count(*)::int as n into temp t_q_before
from public.questions
where topic_id = (select topic_id from curriculum);
grant select on t_q_before to authenticated;

select throws_ok(
  format(
    $fmt$
    select public.import_question_batch(
      %L::uuid,
      jsonb_build_array(
        pg_temp.csv_row(2, 'atomic keep ' || gen_random_uuid()::text),
        pg_temp.csv_row(3, 'atomic fail ' || gen_random_uuid()::text, 'Totally Unknown Book XYZ')
      ),
      false
    )
    $fmt$,
    (select id from t_batch_atomic)
  ),
  'import row 3 failed: unknown book: Totally Unknown Book XYZ',
  'genuine unknown-book error still raises'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.import_rows where batch_id = (select id from t_batch_atomic)),
  0,
  'genuine error leaves no import_rows for the rolled-back call'
);
select is(
  (
    select count(*)::int from public.questions
    where topic_id = (select topic_id from curriculum)
  ),
  (select n from t_q_before),
  'genuine error rolls back earlier inserts in the same call'
);

select * from finish();
rollback;
