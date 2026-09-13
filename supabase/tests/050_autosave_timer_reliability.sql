-- Server-side coverage added for the P1 autosave/timer reliability audit.
-- The client now dispatches save_answer for multiple changed questions
-- concurrently (Promise.all) instead of sequentially — this suite verifies
-- the two DB-level guarantees that pattern relies on: (1) each question's
-- row is independent, so concurrent-shaped saves to different questions in
-- the same attempt never interfere with each other, and (2) a save_answer
-- call reaching the server after expires_at + transport grace, but before
-- any state-machine transition has actually run (i.e. still 'in_progress'),
-- is rejected with 'attempt_expired' — distinct from, and not previously
-- covered alongside, 'attempt_finalized' (020_exam_and_scoring.sql already
-- covers the post-submission case). Transaction-scoped fixtures, rolled
-- back — nothing here persists.

begin;
select plan(4);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Reliability Student') as id
  into temp t_student;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 4, 60, 0
) as id into temp t_test;

grant select on curriculum, t_student, t_test to authenticated;

------------------------------------------------------------------
-- 1) Multiple distinct questions in the same attempt save independently —
--    the data-model guarantee the client's concurrent (Promise.all) dispatch
--    of save_answer for different questions relies on: each row is keyed on
--    (attempt_id, question_version_id), so there is no shared-row contention
--    or ordering dependency between different questions' saves.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_test), '77777777-7777-7777-7777-777777777777'::uuid) as payload
  into temp t_start;
grant select on t_start to authenticated;

select
  ((select payload from t_start) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_q
from jsonb_array_elements((select payload from t_start) -> 'questions') with ordinality;
grant select on t_q to authenticated;

-- Answer all 4 questions with distinct keys, as the client would if it
-- fired save_answer for each concurrently after a multi-answer burst.
select public.save_answer(aid, qv, (array['A','B','C','D'])[ordinality], false, ordinality::bigint,
  '77777777-7777-7777-7777-777777777777'::uuid)
from t_q;

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.attempt_answers where attempt_id = (select aid from t_q limit 1)),
  4,
  'four distinct questions in the same attempt each persist their own independent row'
);
select is(
  (select array_agg(trim(selected_key) order by ordinality)
   from public.attempt_answers aa join t_q on t_q.qv = aa.question_version_id
   where aa.attempt_id = (select aid from t_q limit 1)),
  array['A','B','C','D'],
  'each question kept its own distinct answer — no cross-question overwrite from the concurrent-shaped save pattern'
);

------------------------------------------------------------------
-- 2) save_answer past expires_at + transport grace, while the attempt is
--    still 'in_progress' (i.e. before any cron/lazy finalize has run), is
--    rejected with 'attempt_expired' — the specific error path a client
--    resync/timer bug could otherwise mask or bypass, and one not
--    previously exercised alongside the post-submission 'attempt_finalized'
--    case in 020_exam_and_scoring.sql.
------------------------------------------------------------------
select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '1 minute'
where id = (select aid from t_q limit 1);
select is(
  (select state from public.test_attempts where id = (select aid from t_q limit 1)),
  'in_progress',
  'sanity: the attempt is still in_progress at the DB level (no sweep has run yet)'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.save_answer(%L, %L, ''A'', false, 999, ''77777777-7777-7777-7777-777777777777''::uuid)',
    (select aid from t_q limit 1), (select qv from t_q limit 1)),
  'attempt_expired',
  'save_answer past expires_at + transport grace is rejected with attempt_expired while still in_progress (before any sweep)'
);

select * from finish();
rollback;
