-- Broader business-logic regression suite: things easy to get subtly wrong
-- and that would only surface in production under real usage patterns.

begin;
select plan(11);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Edge Student A') as id
  into temp t_student_a;
select test_helpers.make_student((select year_id from curriculum), 'Edge Student B') as id
  into temp t_student_b;

------------------------------------------------------------------
-- 1) Enrollment promotion: success at a normal year, rejection at year 5
------------------------------------------------------------------
select test_helpers.make_admin() as id into temp t_admin;
grant select on curriculum, t_student_a, t_student_b, t_admin to authenticated;
select test_helpers.as_user((select id from t_admin));

select lives_ok(
  format('select public.promote_student(%L)', (select id from t_student_a)),
  'promoting a student from year 1 to year 2 succeeds'
);
select is(
  (select status from public.enrollments
   where student_id = (select id from t_student_a) and year_id = (select year_id from curriculum)),
  'expired',
  'the old (year 1) enrollment is marked expired after promotion, not deleted'
);
select is(
  (select count(*)::int from public.enrollments
   where student_id = (select id from t_student_a) and status = 'active'),
  1,
  'exactly one active enrollment exists after promotion (in year 2 now)'
);

-- push student B all the way to year 5, then confirm promotion is rejected there
select test_helpers.as_runner();
update public.enrollments set year_id = (select id from public.years where year_number = 5)
where student_id = (select id from t_student_b);
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format('select public.promote_student(%L)', (select id from t_student_b)),
  'already in final year',
  'promoting a year-5 student is rejected — no year 6 to promote into'
);

------------------------------------------------------------------
-- 2) access_grants: duplicate practice_subject grant for the same
--    student+subject is rejected by the unique index (not silently doubled)
------------------------------------------------------------------
select test_helpers.as_runner();
select year_id into temp t_year_a from curriculum;
select id as subject_id into temp t_subject
  from public.subjects where year_id = (select year_id from t_year_a) limit 1;

-- Fresh students for sections 3-5, since A/B above just had their enrollment
-- years deliberately mutated (promoted / pushed to year 5) by section 1 —
-- reusing them here would make start_attempt fail with test_access_denied.
select test_helpers.make_student((select year_id from curriculum), 'Edge Student C') as id
  into temp t_student_c;
select test_helpers.make_student((select year_id from curriculum), 'Edge Student D') as id
  into temp t_student_d;
grant select on t_year_a, t_subject, t_student_c, t_student_d to authenticated;

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format('select public.grant_access(%L, ''practice_subject'', %L)',
    (select id from t_student_a), (select subject_id from t_subject)),
  'first practice grant for this student+subject succeeds'
);
select throws_ok(
  format('select public.grant_access(%L, ''practice_subject'', %L)',
    (select id from t_student_a), (select subject_id from t_subject)),
  'duplicate key value violates unique constraint "access_grants_unique_target"',
  'duplicate practice grant for the same student+subject is rejected by the unique index'
);

------------------------------------------------------------------
-- 3) Ranking ties: two identical scores must share the same rank
--    (RANK(), not ROW_NUMBER() — a real, easy-to-get-wrong distinction)
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'A') as id into temp t_q1;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id into temp t_q2;
select test_helpers.make_published_test((select topic_id from curriculum), (select year_id from t_year_a), 2, 60, 0)
  as id into temp t_tie_test;
grant select on t_q1, t_q2, t_tie_test to authenticated;

select test_helpers.as_user((select id from t_student_c));
select public.start_attempt((select id from t_tie_test), '11111111-aaaa-aaaa-aaaa-000000000001'::uuid) as payload
  into temp t_tie_a;
select public.submit_attempt(
  ((select payload from t_tie_a) ->> 'attempt_id')::uuid, '11111111-aaaa-aaaa-aaaa-000000000001'::uuid
); -- both blank, score 0

select test_helpers.as_user((select id from t_student_d));
select public.start_attempt((select id from t_tie_test), '22222222-bbbb-bbbb-bbbb-000000000002'::uuid) as payload
  into temp t_tie_b;
select public.submit_attempt(
  ((select payload from t_tie_b) ->> 'attempt_id')::uuid, '22222222-bbbb-bbbb-bbbb-000000000002'::uuid
); -- also both blank, score 0 — a genuine tie

select test_helpers.as_runner();
select public.rank_dirty_tests();
select is(
  (select count(distinct rank)::int from public.test_attempts
   where test_id = (select id from t_tie_test) and state = 'submitted'),
  1,
  'two identical (blank) scores share exactly one rank value, not two'
);
select is(
  (select rank from public.test_attempts
   where test_id = (select id from t_tie_test) and student_id = (select id from t_student_c)),
  1,
  'tied attempts both rank #1 (RANK semantics, no arbitrary tiebreak inflation)'
);

------------------------------------------------------------------
-- 4) Void question + credit_all with UNEVEN exposure: a student who never
--    saw the voided question in their shuffled order must be unaffected.
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.make_published_test((select topic_id from curriculum), (select year_id from t_year_a), 5, 60, 0)
  as id into temp t_void_test;
grant select on t_void_test to authenticated;

select test_helpers.as_user((select id from t_student_c));
select public.start_attempt((select id from t_void_test), '33333333-cccc-cccc-cccc-000000000003'::uuid) as payload
  into temp t_void_a;
select public.submit_attempt(
  ((select payload from t_void_a) ->> 'attempt_id')::uuid, '33333333-cccc-cccc-cccc-000000000003'::uuid
) as result into temp t_void_a_before; -- all blank -> score 0, max_score 5

select test_helpers.as_runner();
select question_id into temp t_void_qid from public.test_questions
  where test_id = (select id from t_void_test) order by position limit 1;
grant select on t_void_qid to authenticated;

select test_helpers.as_user((select id from t_admin));
select public.void_test_question((select id from t_void_test), (select question_id from t_void_qid), 'credit_all');

select test_helpers.as_runner();
select is(
  (select score from public.test_attempts
   where id = ((select payload from t_void_a) ->> 'attempt_id')::uuid),
  1::numeric,
  'credit_all void gives full marks for the voided question even to a student who left everything blank'
);
select is(
  (select max_score from public.test_attempts
   where id = ((select payload from t_void_a) ->> 'attempt_id')::uuid),
  5::numeric,
  'credit_all keeps the voided question IN max_score (unlike exclude policy)'
);

------------------------------------------------------------------
-- 5) Materials: a folder scoped to one year is invisible to a student in
--    a different year, even with RLS bypassed only for the setup step.
------------------------------------------------------------------
select test_helpers.as_runner();
-- neither fixture student ends up here: A was promoted to year 2, B was
-- pushed to year 5 in step 1 — year 4 is guaranteed untouched by either.
select id as id into temp t_untouched_year from public.years where year_number = 4;
with ins as (
  insert into public.material_folders (year_id, name)
  values ((select id from t_untouched_year), 'PGTAP fixture folder')
  returning id
)
select id into temp t_folder from ins;
grant select on t_folder to authenticated;

select test_helpers.as_user((select id from t_student_a));
select is(
  (select count(*)::int from public.material_folders where id = (select id from t_folder)),
  0,
  'a student not enrolled in the folder''s year cannot see it'
);

select * from finish();
rollback;
