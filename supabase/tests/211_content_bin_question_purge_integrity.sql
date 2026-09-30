-- Content Bin question purge integrity: no orphan question_versions.
-- Uses LOCAL GUC gate (not session_replication_role=replica).
begin;
select plan(12);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Bin Purge Integrity') as id into temp t_admin;

-- Live baseline question that must survive unrelated purges
select test_helpers.make_question((select topic_id from curriculum)) as id into temp t_keep;

-- Deletable soft-deleted question with 2 versions + practice answer
select test_helpers.make_question((select topic_id from curriculum)) as id into temp t_purge;
grant select on curriculum, t_admin, t_keep, t_purge to anon, authenticated;
select test_helpers.as_user((select id from t_admin));
select public.create_question_version(
  (select id from t_purge),
  'Purged stem v2',
  '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
  'A',
  'exp',
  'ref'
);
select test_helpers.as_runner();
insert into public.practice_answers (
  student_id, question_version_id, selected_key, is_correct, subject_id, chapter_id, topic_id
)
select
  (select id from t_admin),
  qv.id,
  'A',
  true,
  (select subject_id from curriculum),
  (select chapter_id from curriculum),
  (select topic_id from curriculum)
from public.question_versions qv
where qv.question_id = (select id from t_purge)
order by qv.version_no
limit 1;

update public.questions
set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = (select id from t_admin)
where id = (select id from t_purge);

-- Test-referenced soft-deleted question (must block)
select test_helpers.make_question((select topic_id from curriculum)) as id into temp t_blocked;
grant select on t_blocked to anon, authenticated;

with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, min_questions
  ) values (
    'Bin purge block test',
    (select year_id from curriculum),
    'draft',
    now() + interval '1 day',
    now() + interval '2 days',
    30,
    1
  )
  returning id
)
select id into temp t_test from ins;
grant select on t_test to anon, authenticated;
insert into public.test_questions (test_id, question_id, question_version_id, position)
select
  (select id from t_test),
  (select id from t_blocked),
  q.current_version_id,
  1
from public.questions q where q.id = (select id from t_blocked);
update public.questions
set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = (select id from t_admin)
where id = (select id from t_blocked);

select is(
  (select count(*)::int from public.question_versions where question_id = (select id from t_purge)),
  2,
  'fixture purge target has two versions before purge'
);

------------------------------------------------------------------
-- Single purge_content: versions cascade, no orphans
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  $$select public.purge_content('question', (select id from t_purge))$$,
  'purge_content hard-deletes soft-deleted question'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.questions where id = (select id from t_purge)),
  0,
  'purged question row is gone'
);
select is(
  (select count(*)::int from public.question_versions where question_id = (select id from t_purge)),
  0,
  'question_versions for purged question are gone (no orphans)'
);
select is(
  (
    select count(*)::int
    from public.question_versions qv
    where not exists (select 1 from public.questions q where q.id = qv.question_id)
  ),
  0,
  'global orphan_qv = 0 after single purge'
);
select ok(
  exists (select 1 from public.questions where id = (select id from t_keep)),
  'unrelated live question remains'
);

------------------------------------------------------------------
-- Batch path: purge one, block test-referenced
------------------------------------------------------------------
select test_helpers.make_question((select topic_id from curriculum)) as id into temp t_batch;
grant select on t_batch to anon, authenticated;
update public.questions
set deleted_at = now(), purge_after = now() + interval '7 days', deleted_by = (select id from t_admin)
where id = (select id from t_batch);

select test_helpers.as_user((select id from t_admin));
select results_eq(
  $$
    select outcome, detail
    from public.purge_content_batch(jsonb_build_array(
      jsonb_build_object('entity_type','question','entity_id',(select id from t_batch)),
      jsonb_build_object('entity_type','question','entity_id',(select id from t_blocked))
    ))
    order by outcome, detail nulls first
  $$,
  $$
    values
      ('blocked'::text, 'question_referenced_by_test'::text),
      ('purged'::text, null::text)
  $$,
  'batch purges deletable and blocks test-referenced'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.question_versions where question_id = (select id from t_batch)),
  0,
  'batch-purged question has no leftover versions'
);
select ok(
  exists (select 1 from public.questions where id = (select id from t_blocked)),
  'test-referenced soft-deleted question still present'
);
select ok(
  exists (select 1 from public.test_questions where question_id = (select id from t_blocked)),
  'test_questions link intact for blocked question'
);
select is(
  (
    select count(*)::int
    from public.question_versions qv
    where not exists (select 1 from public.questions q where q.id = qv.question_id)
  ),
  0,
  'global orphan_qv = 0 after batch purge'
);

------------------------------------------------------------------
-- Immutability still holds without GUC
------------------------------------------------------------------
select throws_ok(
  format(
    'delete from public.question_versions where question_id = %L',
    (select id from t_keep)
  ),
  'question_versions are immutable (append-only)',
  'direct DELETE of versions still blocked without purge GUC'
);

select * from finish();
rollback;
