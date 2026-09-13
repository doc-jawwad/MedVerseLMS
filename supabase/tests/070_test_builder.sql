-- Test Builder: regression coverage for validate_test's checklist,
-- duplicate-question rejection, position/reorder invariants, post-publish
-- immutability of test_questions, and per-question marks overrides actually
-- affecting scoring. None of this had pgTAP coverage before (confirmed via
-- exploration: existing suites only touch test_questions incidentally via
-- fixture setup or void_test_question). Transaction-scoped fixtures, rolled
-- back — nothing here persists.

begin;
select plan(16);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('TB Admin') as id into temp t_admin;
select test_helpers.make_student((select year_id from curriculum), 'TB Student') as id
  into temp t_student;

grant select on curriculum, t_admin, t_student to authenticated;

------------------------------------------------------------------
-- 1) validate_test / publish_test are admin-only.
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.tests (title, year_id, status, opens_at, closes_at, duration_minutes, marks_per_question, negative_mark, min_questions)
  values ('TB draft test', (select year_id from curriculum), 'draft', now() - interval '1 minute', now() + interval '3 hours', 60, 1, 0, 1)
  returning id
)
select id into temp t_test_id from ins;
grant select on t_test_id to authenticated;

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.validate_test(%L)', (select id from t_test_id)),
  'admin only',
  'a student cannot call validate_test'
);

------------------------------------------------------------------
-- 2) validate_test on an empty draft: question-count check fails,
--    audience check fails; everything else (schedule/duration/marking)
--    passes since the test row itself is well-formed.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select checks into temp t_checks0 from (
  select public.validate_test((select id from t_test_id)) as checks
) s;
grant select on t_checks0 to authenticated;

select is(
  (select (c ->> 'pass')::boolean from t_checks0, jsonb_array_elements(checks) c
   where c ->> 'check' like 'question count%'),
  false,
  'an empty draft test fails the question-count check'
);
select is(
  (select (c ->> 'pass')::boolean from t_checks0, jsonb_array_elements(checks) c
   where c ->> 'check' like 'audience assigned%'),
  false,
  'an empty draft test with no audience fails the audience check'
);
select is(
  (select (c ->> 'pass')::boolean from t_checks0, jsonb_array_elements(checks) c
   where c ->> 'check' = 'valid schedule'),
  true,
  'a well-formed schedule passes independent of question/audience state'
);

select throws_ok(
  format('select public.publish_test(%L)', (select id from t_test_id)),
  'validation failed: question count >= 1',
  'publish_test refuses an empty test and reports the first failing check'
);

------------------------------------------------------------------
-- 3) Add two approved questions + an audience; every check now passes.
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'A') as id into temp t_q1;
select test_helpers.make_question((select topic_id from curriculum), 'B') as id into temp t_q2;
grant select on t_q1, t_q2 to authenticated;

-- Captured now (as runner) so the answer-saving step below never needs to
-- query public.questions while impersonating the student — who correctly
-- has zero SELECT privilege on that table (060_question_bank.sql #17).
select id as question_id, current_version_id as version_id
into temp t_q_meta
from public.questions where id in ((select id from t_q1), (select id from t_q2));
grant select on t_q_meta to authenticated;

insert into public.test_questions (test_id, question_id, position)
values ((select id from t_test_id), (select id from t_q1), 1),
       ((select id from t_test_id), (select id from t_q2), 2);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_test_id), (select year_id from curriculum));

select test_helpers.as_user((select id from t_admin));
select checks into temp t_checks1 from (
  select public.validate_test((select id from t_test_id)) as checks
) s;
select is(
  (select bool_and((c ->> 'pass')::boolean) from t_checks1, jsonb_array_elements(checks) c),
  true,
  'a well-formed test with 2 approved questions and an audience passes every checklist item'
);

------------------------------------------------------------------
-- 4) Duplicate question rejected by the DB constraint (this is what makes
--    "no duplicate questions" true by construction, not a separate
--    validate_test checklist item).
------------------------------------------------------------------
select test_helpers.as_runner();
select throws_ok(
  format('insert into public.test_questions (test_id, question_id, position) values (%L, %L, 3)',
    (select id from t_test_id), (select id from t_q1)),
  'duplicate key value violates unique constraint "test_questions_test_id_question_id_key"',
  'adding the same question twice to a test is rejected by unique(test_id, question_id)'
);

------------------------------------------------------------------
-- 5) Position reordering pre-publish via the real reorder_test_question()
--    RPC (20260913000006_reorder_test_question_atomic.sql) — not a
--    hand-rolled mimicry of the client's old (now-removed) three-step
--    swap. Covers: admin-only, no-op at the first-position edge, and the
--    actual swap.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.reorder_test_question(%L, %L, ''down'')',
    (select id from t_test_id), (select id from t_q1)),
  'admin only',
  'a student cannot call reorder_test_question'
);

select test_helpers.as_user((select id from t_admin));
-- q1 is already at position 1 (first); moving it "up" must be a no-op.
select public.reorder_test_question((select id from t_test_id), (select id from t_q1), 'up');
select is(
  (select position from public.test_questions where test_id = (select id from t_test_id) and question_id = (select id from t_q1)),
  1,
  'moving the first question "up" is a silent no-op — position unchanged'
);

select public.reorder_test_question((select id from t_test_id), (select id from t_q1), 'down');
select is(
  (select question_id from public.test_questions where test_id = (select id from t_test_id) and position = 1),
  (select id from t_q2),
  'question 2 now occupies position 1 after reorder_test_question swaps q1 down'
);
select is(
  (select question_id from public.test_questions where test_id = (select id from t_test_id) and position = 2),
  (select id from t_q1),
  'question 1 now occupies position 2 after the swap'
);

------------------------------------------------------------------
-- 6) Per-question marks override: set marks=2 on q1 (test default is 1),
--    publish, submit a perfect-score attempt, and confirm the frozen
--    per-question override — not the test default — is what scoring used.
------------------------------------------------------------------
update public.test_questions set marks = 2 where test_id = (select id from t_test_id) and question_id = (select id from t_q1);

select test_helpers.as_user((select id from t_admin));
select public.publish_test((select id from t_test_id));

select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_test_id), '44444444-4444-4444-4444-444444444444'::uuid) as payload
  into temp t_start;
grant select on t_start to authenticated;

select
  ((select payload from t_start) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_qorder
from jsonb_array_elements((select payload from t_start) -> 'questions') with ordinality;

-- answer both correctly (q1 correct_key='A', q2 correct_key='B', per fixtures above)
select public.save_answer(t_qorder.aid, t_qorder.qv, 'A', false, t_qorder.ordinality::bigint, '44444444-4444-4444-4444-444444444444'::uuid)
  from t_qorder join t_q_meta on t_q_meta.version_id = t_qorder.qv
  where t_q_meta.question_id = (select id from t_q1);
select public.save_answer(t_qorder.aid, t_qorder.qv, 'B', false, t_qorder.ordinality::bigint + 10, '44444444-4444-4444-4444-444444444444'::uuid)
  from t_qorder join t_q_meta on t_q_meta.version_id = t_qorder.qv
  where t_q_meta.question_id = (select id from t_q2);

select public.submit_attempt(
  (select aid from t_qorder limit 1), '44444444-4444-4444-4444-444444444444'::uuid
) as result into temp t_result;

-- max_score = q1's override (2) + q2's test-default (1) = 3; perfect score = 3.
select is(
  ((select result from t_result) ->> 'max_score')::numeric, 3.00,
  'max_score reflects the per-question marks override (2) plus the test default (1), not 2x test default'
);
select is(
  ((select result from t_result) ->> 'score')::numeric, 3.00,
  'a perfect-score attempt scores the overridden marks total, confirming the override actually reached scoring'
);

------------------------------------------------------------------
-- 7) After publish, test_questions is frozen: position, question_id, and
--    question_version_id can no longer change — only voided/void_policy.
------------------------------------------------------------------
select test_helpers.as_runner();
select throws_ok(
  format('update public.test_questions set position = 99 where test_id = %L and question_id = %L',
    (select id from t_test_id), (select id from t_q1)),
  'only voiding may change on a published test',
  'position cannot be changed on test_questions once the test is published'
);
select throws_ok(
  format('insert into public.test_questions (test_id, question_id, position) values (%L, %L, 5)',
    (select id from t_test_id), (select id from t_q2)),
  'questions of a published test are frozen',
  'no new question can be inserted into test_questions once the test is published'
);

select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format('select public.reorder_test_question(%L, %L, ''up'')',
    (select id from t_test_id), (select id from t_q1)),
  'only voiding may change on a published test',
  'reorder_test_question is also blocked post-publish — the trigger fires regardless of caller, including this SECURITY DEFINER RPC'
);

select * from finish();
rollback;
