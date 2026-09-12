-- Scoring + exam-engine regression suite (docs/scoring-rules.md,
-- docs/exam-state-machine.md). Transaction-scoped fixtures, rolled back.

begin;
select plan(15);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Scorer') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'Second Scorer') as id
  into temp t_student2;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 5, 60, 0.25
) as id into temp t_test1;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_test2;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_test3;

grant select on curriculum, t_student, t_student2, t_test1, t_test2, t_test3
  to authenticated;

------------------------------------------------------------------
-- 1) Negative marking arithmetic: 3 correct, 1 wrong, 1 blank, marks=1, neg=0.25
--    score = 3*1 - 1*0.25 = 2.75
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_test1), '11111111-1111-1111-1111-111111111111'::uuid) as payload
  into temp t_start1;
grant select on t_start1 to authenticated;

select
  ((select payload from t_start1) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_q1
from jsonb_array_elements((select payload from t_start1) -> 'questions') with ordinality;
grant select on t_q1 to authenticated;

-- answer q1-3 correctly ('A'), q4 wrong ('B'), q5 left blank
select public.save_answer(aid, qv, 'A', false, ordinality::bigint, '11111111-1111-1111-1111-111111111111'::uuid)
  from t_q1 where ordinality <= 3;
select public.save_answer(aid, qv, 'B', false, ordinality::bigint, '11111111-1111-1111-1111-111111111111'::uuid)
  from t_q1 where ordinality = 4;

select public.submit_attempt(
  (select aid from t_q1 limit 1), '11111111-1111-1111-1111-111111111111'::uuid
) as result into temp t_result1;
grant select on t_result1 to authenticated;

select is(
  ((select result from t_result1) ->> 'score')::numeric, 2.75,
  'negative marking: 3 correct + 1 wrong (-0.25) + 1 blank = 2.75'
);
select is(((select result from t_result1) ->> 'raw_correct')::int, 3, 'raw_correct = 3');
select is(((select result from t_result1) ->> 'raw_wrong')::int, 1, 'raw_wrong = 1');
select is(((select result from t_result1) ->> 'raw_blank')::int, 1, 'raw_blank = 1');

------------------------------------------------------------------
-- 2) Idempotent submit: duplicate submit_attempt call returns identical result
------------------------------------------------------------------
select public.submit_attempt(
  (select aid from t_q1 limit 1), '11111111-1111-1111-1111-111111111111'::uuid
) as result into temp t_result1_dup;

select is(
  (select result from t_result1_dup),
  (select result from t_result1),
  'duplicate submit_attempt returns an identical idempotent result'
);

------------------------------------------------------------------
-- 3) save_answer after finalization is rejected outright
------------------------------------------------------------------
select throws_ok(
  format('select public.save_answer(%L, %L, ''A'', false, 999, ''11111111-1111-1111-1111-111111111111''::uuid)',
    (select aid from t_q1 limit 1), (select qv from t_q1 limit 1)),
  'attempt_finalized',
  'save_answer after submission is rejected (state machine terminal)'
);

------------------------------------------------------------------
-- 4) A finalized attempt cannot be "started" again
------------------------------------------------------------------
select throws_ok(
  format('select public.start_attempt(%L, ''22222222-2222-2222-2222-222222222222''::uuid)', (select id from t_test1)),
  'already_submitted',
  'start_attempt on an already-submitted test raises already_submitted regardless of device'
);

------------------------------------------------------------------
-- 5) save_seq monotonic guard: a stale (lower) sequence number never overwrites
------------------------------------------------------------------
select public.start_attempt((select id from t_test2), '33333333-3333-3333-3333-333333333333'::uuid) as payload
  into temp t_start2;
grant select on t_start2 to authenticated;

select
  ((select payload from t_start2) ->> 'attempt_id')::uuid as aid,
  ((select payload from t_start2) -> 'questions' -> 0 ->> 'question_version_id')::uuid as qv
into temp t_ctx2;
grant select on t_ctx2 to authenticated;

select public.save_answer((select aid from t_ctx2), (select qv from t_ctx2),
  'A', false, 5, '33333333-3333-3333-3333-333333333333'::uuid);
-- stale save with a LOWER seq trying to overwrite with a different answer
select public.save_answer((select aid from t_ctx2), (select qv from t_ctx2),
  'B', false, 2, '33333333-3333-3333-3333-333333333333'::uuid);

select test_helpers.as_runner();
select is(
  (select trim(selected_key) from public.attempt_answers
   where attempt_id = (select aid from t_ctx2) and question_version_id = (select qv from t_ctx2)),
  'A',
  'stale save_seq (2 < 5) does not overwrite the later answer'
);

------------------------------------------------------------------
-- 6) Device lock on save_answer: wrong device is rejected
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.save_answer(%L, %L, ''A'', false, 6, ''99999999-9999-9999-9999-999999999999''::uuid)',
    (select aid from t_ctx2), (select qv from t_ctx2)),
  'attempt_locked_other_device',
  'save_answer from a different device_id than start_attempt is rejected'
);

------------------------------------------------------------------
-- 7) Resume preserves the frozen question order and saved answers
------------------------------------------------------------------
select public.start_attempt((select id from t_test2), '33333333-3333-3333-3333-333333333333'::uuid) as payload
  into temp t_resume2;
select is(
  (select payload from t_resume2) -> 'questions' -> 0 ->> 'question_version_id',
  (select payload from t_start2) -> 'questions' -> 0 ->> 'question_version_id',
  'resume returns the same frozen question order as the original start'
);
select is(
  (select jsonb_array_length((select payload from t_resume2) -> 'answers')),
  1,
  'resume restores the previously saved answer'
);

------------------------------------------------------------------
-- 8) auto_submit_expired finalizes overdue attempts with submit_source=auto
------------------------------------------------------------------
select test_helpers.as_runner();
update public.test_attempts set expires_at = now() - interval '2 minutes'
where id = (select aid from t_ctx2);

select public.auto_submit_expired();

select is(
  (select state from public.test_attempts where id = (select aid from t_ctx2)),
  'submitted',
  'auto_submit_expired finalizes an attempt past expires_at + 60s'
);
select is(
  (select submit_source from public.test_attempts where id = (select aid from t_ctx2)),
  'auto',
  'auto-finalized attempt is tagged submit_source=auto'
);

------------------------------------------------------------------
-- 9) Ranking: two attempts on the same test rank correctly with percentile
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_test3), '55555555-5555-5555-5555-555555555555'::uuid) as payload
  into temp t_start3a;
select public.submit_attempt(
  ((select payload from t_start3a) ->> 'attempt_id')::uuid,
  '55555555-5555-5555-5555-555555555555'::uuid
); -- everything left blank: score 0

select test_helpers.as_user((select id from t_student2));
select public.start_attempt((select id from t_test3), '66666666-6666-6666-6666-666666666666'::uuid) as payload
  into temp t_start3b;
grant select on t_start3b to authenticated;

select
  ((select payload from t_start3b) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_q3b
from jsonb_array_elements((select payload from t_start3b) -> 'questions') with ordinality;

select public.save_answer(aid, qv, 'A', false, ordinality::bigint, '66666666-6666-6666-6666-666666666666'::uuid)
  from t_q3b;
select public.submit_attempt(
  (select aid from t_q3b limit 1), '66666666-6666-6666-6666-666666666666'::uuid
); -- perfect score

select test_helpers.as_runner();
select is(
  (select rank from public.test_attempts
   where test_id = (select id from t_test3) and student_id = (select id from t_student2)),
  1,
  'perfect-score attempt ranks #1'
);
select is(
  (select rank from public.test_attempts
   where test_id = (select id from t_test3) and student_id = (select id from t_student)),
  2,
  'zero-score attempt ranks #2'
);

select * from finish();
rollback;
