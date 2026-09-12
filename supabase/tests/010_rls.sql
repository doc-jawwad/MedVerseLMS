-- RLS regression suite (docs/permissions.md matrix). Run inside a transaction
-- that the caller rolls back; every fixture is scoped to this run.

begin;
select plan(19);

-- fixtures
select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

select test_helpers.make_student((select year_id from curriculum), 'Student A') as id
  into temp t_student_a;
select test_helpers.make_student((select year_id from curriculum), 'Student B') as id
  into temp t_student_b;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_approved_q;

-- a draft (unapproved) question, for the "students never see unapproved" check
select test_helpers.as_runner();
with ins as (
  insert into public.questions (topic_id, status, difficulty, content_hash, stem_normalized)
  values ((select topic_id from curriculum), 'draft', 'medium', gen_random_uuid()::text, 'draft q')
  returning id
)
select id into temp t_draft_q from ins;

-- Fixture temp tables are owned by the runner role; grant read access so
-- assertions can reference fixture ids after SET LOCAL ROLE anon/authenticated.
grant select on curriculum, t_student_a, t_student_b, t_approved_q, t_draft_q
  to anon, authenticated;

------------------------------------------------------------------
-- 1) Anonymous: no visibility into any student data
------------------------------------------------------------------
-- anon has no table grants at all (docs/database.md: public data flows only
-- through security-definer RPCs like list_years), so these fail at the grant
-- level with a hard permission error, not a silent RLS-filtered empty set.
select test_helpers.as_anon();
select throws_ok(
  'select count(*) from public.profiles',
  'permission denied for table profiles',
  'anon has zero table privileges on profiles'
);
select throws_ok(
  'select count(*) from public.enrollments',
  'permission denied for table enrollments',
  'anon has zero table privileges on enrollments'
);

------------------------------------------------------------------
-- 2) Student A cannot read Student B's profile/enrollment
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student_a));
select is(
  (select count(*)::int from public.profiles where id = (select id from t_student_b)),
  0,
  'student A cannot select student B profile'
);
select is(
  (select count(*)::int from public.enrollments where student_id = (select id from t_student_b)),
  0,
  'student A cannot select student B enrollment'
);
select is(
  (select count(*)::int from public.profiles where id = (select id from t_student_a)),
  1,
  'student A can select own profile'
);

------------------------------------------------------------------
-- 3) Students cannot change their own role
------------------------------------------------------------------
select throws_ok(
  format('update public.profiles set role = ''admin'' where id = %L', (select id from t_student_a)),
  'role changes require admin',
  'student cannot self-promote to admin'
);

------------------------------------------------------------------
-- 4) Question bank: students have no direct SELECT (RPC-only per docs)
------------------------------------------------------------------
select is(
  (select count(*)::int from public.questions where id = (select id from t_approved_q)),
  0,
  'student cannot directly SELECT an approved question row (exam RPC only)'
);
select is(
  (select count(*)::int from public.questions where id = (select id from t_draft_q)),
  0,
  'student cannot directly SELECT a draft question row either'
);
select is(
  (select count(*)::int from public.question_versions),
  0,
  'student cannot directly SELECT question_versions'
);

------------------------------------------------------------------
-- 5) Students cannot write questions or their own enrollment status
------------------------------------------------------------------
select throws_ok(
  format('insert into public.questions (topic_id, status, difficulty) values (%L, ''draft'', ''easy'')',
    (select topic_id from curriculum)),
  'new row violates row-level security policy for table "questions"',
  'student cannot insert a question'
);

-- Enrollments have no student UPDATE policy at all (admin-only ALL policy);
-- Postgres RLS makes a WHERE clause the student can't see match 0 rows and
-- silently no-ops rather than raising, so assert "nothing changed" instead.
select test_helpers.as_runner();
update public.enrollments set status = 'suspended' where student_id = (select id from t_student_a);
select test_helpers.as_user((select id from t_student_a));
update public.enrollments set status = 'active' where student_id = (select id from t_student_a);
select test_helpers.as_runner();
select is(
  (select status from public.enrollments where student_id = (select id from t_student_a)),
  'suspended',
  'student UPDATE on enrollments matches zero rows under RLS (status left untouched)'
);
-- restore for the remaining sections, which need an active enrollment
update public.enrollments set status = 'active' where student_id = (select id from t_student_a);

------------------------------------------------------------------
-- 6) Test access: /tests/[id] must fail at the DB level when ungranted
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 3
) as id into temp t_test;

-- a SECOND year with no audience/grant for our students, to prove isolation
select test_helpers.as_runner();
select id as id into temp t_other_year from public.years where year_number = 2;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select id from t_other_year), 2
) as id into temp t_other_test;

grant select on t_test, t_other_year, t_other_test to anon, authenticated;

select test_helpers.as_user((select id from t_student_a));
select is(
  (select count(*)::int from public.tests where id = (select id from t_test)),
  1,
  'student in the audience year can see the published test row'
);
select is(
  (select count(*)::int from public.tests where id = (select id from t_other_test)),
  0,
  'student NOT in the audience year gets ZERO rows for a different test (direct /tests/[id] guess fails)'
);
select is(
  (select count(*)::int from public.test_questions where test_id = (select id from t_test)),
  0,
  'students never see test_questions directly, even for a test they can access'
);

------------------------------------------------------------------
-- 7) Attempts: student B cannot read or mutate student A's attempt
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student_a));
select public.start_attempt((select id from t_test), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid)
  as payload into temp t_start;
select ((select payload from t_start) ->> 'attempt_id')::uuid as id into temp t_attempt_a;

select test_helpers.as_user((select id from t_student_b));
select is(
  (select count(*)::int from public.test_attempts where id = (select id from t_attempt_a)),
  0,
  'student B cannot select student A''s attempt row'
);
select throws_ok(
  format('select public.save_answer(%L, gen_random_uuid(), ''A'', false, 1, ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''::uuid)',
    (select id from t_attempt_a)),
  'attempt_not_found',
  'student B cannot save an answer into student A''s attempt (RLS hides it from the ownership lookup)'
);

select test_helpers.as_user((select id from t_student_a));
select is(
  (select count(*)::int from public.test_attempts
   where id = (select id from t_attempt_a) and student_id = (select id from t_student_a)),
  1,
  'student A can select their own attempt'
);
-- test_attempts has no student UPDATE policy (admin-only ALL); same
-- zero-rows-matched no-op as the enrollments case above.
update public.test_attempts set score = 999 where id = (select id from t_attempt_a);
select test_helpers.as_runner();
select isnt(
  (select score from public.test_attempts where id = (select id from t_attempt_a)),
  999::numeric,
  'student UPDATE on test_attempts matches zero rows under RLS (score untouched, RPC-only mutation holds)'
);

------------------------------------------------------------------
-- 8) question_versions are immutable, even with RLS bypassed
------------------------------------------------------------------
select test_helpers.as_runner();
select throws_ok(
  format('update public.question_versions set correct_key = ''B'' where question_id = %L',
    (select id from t_approved_q)),
  'question_versions are immutable (append-only)',
  'question_versions cannot be mutated even with RLS bypassed'
);

select * from finish();
rollback;
