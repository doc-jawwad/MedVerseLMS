-- import_batches.created_by ownership: admin inserts attribute to auth.uid(),
-- another admin cannot spoof owner, concurrent batches keep distinct owners,
-- CSV import + question created_by unchanged.
-- Transaction-scoped fixtures — rolled back; nothing persists.

begin;
select plan(11);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Batch Owner A') as id into temp t_admin_a;
select test_helpers.make_admin('Batch Owner B') as id into temp t_admin_b;

grant select on curriculum, t_admin_a, t_admin_b to anon, authenticated;

create function pg_temp.csv_row(
  p_row int,
  p_stem text
) returns jsonb language sql as $$
  select jsonb_build_object(
    'row_number', p_row,
    'subject_id', (select subject_id from curriculum),
    'book', (select name from public.books where id = (select book_id from curriculum)),
    'chapter', (select name from public.chapters where id = (select chapter_id from curriculum)),
    'topic', (select name from public.topics where id = (select topic_id from curriculum)),
    'stem', p_stem,
    'options', '[{"key":"A","text":"Opt A"},{"key":"B","text":"Opt B"},{"key":"C","text":"Opt C"},{"key":"D","text":"Opt D"}]'::jsonb,
    'correct_key', 'A',
    'explanation', 'because',
    'reference', 'ref',
    'difficulty', 'easy',
    'tags', '["own"]'::jsonb,
    'status', 'approved'
  );
$$;

------------------------------------------------------------------
-- 1) Admin A creates batch with created_by = auth.uid()
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('owner-a.csv', 1, auth.uid())
  returning id, created_by
)
select id, created_by into temp t_batch_a from ins;
grant select on t_batch_a to authenticated;

select test_helpers.as_runner();
select is(
  (select created_by from t_batch_a),
  (select id from t_admin_a),
  'admin A batch created_by equals admin A'
);

select test_helpers.as_user((select id from t_admin_a));
select is(
  (select created_by from public.import_batches where id = (select id from t_batch_a)),
  auth.uid(),
  'admin A session: batch created_by = auth.uid()'
);

------------------------------------------------------------------
-- 2) Admin B cannot spoof batch ownership as admin A
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_b));

select throws_ok(
  format(
    $fmt$
    insert into public.import_batches (filename, total_rows, created_by)
    values ('spoof.csv', 1, %L::uuid)
    $fmt$,
    (select id from t_admin_a)
  ),
  'new row violates row-level security policy for table "import_batches"',
  'admin B cannot insert a batch owned by admin A'
);

select throws_ok(
  format(
    $fmt$
    update public.import_batches
    set created_by = %L::uuid
    where id = %L::uuid
    $fmt$,
    (select id from t_admin_b),
    (select id from t_batch_a)
  ),
  'import_batches.created_by is immutable',
  'admin B cannot reassign admin A batch ownership'
);

with ins as (
  insert into public.import_batches (filename, total_rows, created_by)
  values ('owner-b.csv', 1, auth.uid())
  returning id, created_by
)
select id, created_by into temp t_batch_b from ins;
grant select on t_batch_b to authenticated;

select test_helpers.as_runner();
select is(
  (select created_by from t_batch_b),
  (select id from t_admin_b),
  'admin B batch created_by equals admin B'
);
select isnt(
  (select created_by from t_batch_a),
  (select created_by from t_batch_b),
  'concurrent admins retain distinct batch ownership'
);

------------------------------------------------------------------
-- 3) CSV import still works; question created_by remains auth.uid()
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin_a));
select public.import_question_batch(
  (select id from t_batch_a),
  jsonb_build_array(pg_temp.csv_row(2, 'batch-own-a ' || gen_random_uuid()::text)),
  true
) as result into temp t_import_a;
grant select on t_import_a to authenticated;

select test_helpers.as_user((select id from t_admin_b));
select public.import_question_batch(
  (select id from t_batch_b),
  jsonb_build_array(pg_temp.csv_row(2, 'batch-own-b ' || gen_random_uuid()::text)),
  true
) as result into temp t_import_b;
grant select on t_import_b to authenticated;

select test_helpers.as_runner();
select is(
  (select (result ->> 'inserted')::int from t_import_a),
  1,
  'admin A CSV import still inserts'
);
select is(
  (select (result ->> 'inserted')::int from t_import_b),
  1,
  'admin B CSV import still inserts'
);

select is(
  (
    select q.created_by from public.questions q
    where q.id = ((select result -> 'question_ids' ->> 0 from t_import_a)::uuid)
  ),
  (select id from t_admin_a),
  'question created_by remains importer A (unchanged behavior)'
);
select is(
  (
    select q.created_by from public.questions q
    where q.id = ((select result -> 'question_ids' ->> 0 from t_import_b)::uuid)
  ),
  (select id from t_admin_b),
  'question created_by remains importer B (unchanged behavior)'
);

select is(
  (select created_by from public.import_batches where id = (select id from t_batch_a)),
  (select id from t_admin_a),
  'import RPC does not rewrite batch created_by for A'
);

select * from finish();
rollback;
