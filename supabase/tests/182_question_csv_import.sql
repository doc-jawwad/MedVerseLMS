-- Question Bank CSV import RPC: atomic rollback, duplicate skip (no overwrite),
-- refusal of client_errors payloads, and question_ids in the result.
-- Transaction-scoped fixtures — rolled back; nothing persists.

begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('CSV Import Admin') as id into temp t_admin;

grant select on curriculum, t_admin to anon, authenticated;

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
    'tags', '["csv"]'::jsonb,
    'status', 'draft'
  );
$$;

------------------------------------------------------------------
-- 1) Happy path
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('ok.csv', 1, (select id from t_admin))
  returning id
)
select id into temp t_batch_ok from ins;
grant select on t_batch_ok to authenticated;

select public.import_question_batch(
  (select id from t_batch_ok),
  jsonb_build_array(pg_temp.csv_row(2, 'CSV unique stem alpha ' || gen_random_uuid()::text)),
  true
) as result into temp t_ok_result;
grant select on t_ok_result to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_ok_result),
  1,
  'import inserts one valid row'
);
select is(
  jsonb_array_length((select result -> 'question_ids' from t_ok_result)),
  1,
  'import returns question_ids for inserted rows'
);
select is(
  (select outcome from public.import_rows where batch_id = (select id from t_batch_ok)),
  'inserted',
  'import_rows records inserted outcome'
);

------------------------------------------------------------------
-- 2) Duplicate handling
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('dup.csv', 1, (select id from t_admin))
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
      'status', 'draft'
    )
  ),
  true
) as result into temp t_dup_result;
grant select on t_dup_result to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'skipped')::int from t_dup_result),
  1,
  'duplicate content_hash is skipped'
);
select is(
  (select (result ->> 'inserted')::int from t_dup_result),
  0,
  'duplicate does not insert a second question'
);
select is(
  (select outcome from public.import_rows where batch_id = (select id from t_batch_dup)),
  'skipped_duplicate',
  'duplicate outcome is explicit skipped_duplicate'
);

------------------------------------------------------------------
-- 3) client_errors refused
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('bad.csv', 1, (select id from t_admin))
  returning id
)
select id into temp t_batch_bad from ins;
grant select on t_batch_bad to authenticated;

select throws_ok(
  format(
    $fmt$
    select public.import_question_batch(
      %L::uuid,
      jsonb_build_array(
        pg_temp.csv_row(2, 'should not insert') || jsonb_build_object(
          'client_errors', '["correct must be A–E"]'::jsonb
        )
      ),
      true
    )
    $fmt$,
    (select id from t_batch_bad)
  ),
  'csv_validation_required: fix CSV errors before import',
  'payload with client_errors is refused before any insert'
);

------------------------------------------------------------------
-- 4) Atomic rollback
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('atomic.csv', 2, (select id from t_admin))
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
        pg_temp.csv_row(2, 'atomic stem keep ' || gen_random_uuid()::text),
        pg_temp.csv_row(3, 'atomic stem fail ' || gen_random_uuid()::text, 'Totally Unknown Book XYZ')
      ),
      false
    )
    $fmt$,
    (select id from t_batch_atomic)
  ),
  'import row 3 failed: unknown book: Totally Unknown Book XYZ',
  'hard error raises with row context'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.import_rows where batch_id = (select id from t_batch_atomic)),
  0,
  'atomic failure leaves no import_rows for the rolled-back batch call'
);
select is(
  (
    select count(*)::int from public.questions
    where topic_id = (select topic_id from curriculum)
  ),
  (select n from t_q_before),
  'atomic failure rolls back the earlier insert in the same call'
);

select * from finish();
rollback;
