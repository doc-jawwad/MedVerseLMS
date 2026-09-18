-- start_attempt lock-scope: deferred FOR UPDATE must not change exam contracts.
begin;
select plan(13);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_s1 as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'lock-scope-a@test.invalid', 'LockScope A', 'student', 'active')
  returning id
) select id from ins;
create temp table t_s2 as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'lock-scope-b@test.invalid', 'LockScope B', 'student', 'active')
  returning id
) select id from ins;
create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'lock-scope-admin@test.invalid', 'LockScope Admin', 'admin', 'active', true)
  returning id
) select id from ins;

insert into public.enrollments (student_id, year_id, status)
values
  ((select id from t_s1), (select year_id from curriculum), 'active'),
  ((select id from t_s2), (select year_id from curriculum), 'active');

create temp table t_live as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP lock live', (select year_id from curriculum), 'draft',
    now() - interval '1 minute', now() + interval '2 hours', 60, 0, 1
  ) returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
select (select id from t_live), test_helpers.make_question((select topic_id from curriculum), 'A'), gs
from generate_series(1, 3) gs;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_live), (select year_id from curriculum));

create temp table t_closed as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP lock closed', (select year_id from curriculum), 'draft',
    now() - interval '1 minute', now() + interval '2 hours', 60, 0, 1
  ) returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
select (select id from t_closed), test_helpers.make_question((select topic_id from curriculum), 'A'), 1;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_closed), (select year_id from curriculum));

create temp table t_late as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP late start', (select year_id from curriculum), 'draft',
    now() - interval '2 hours', now() + interval '10 minutes', 60, 0, 1
  )
  returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
select (select id from t_late), test_helpers.make_question((select topic_id from curriculum), 'A'), 1;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_late), (select year_id from curriculum));

create temp table t_future as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP future start', (select year_id from curriculum), 'draft',
    now() + interval '1 hour', now() + interval '3 hours', 60, 0, 1
  )
  returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
select (select id from t_future), test_helpers.make_question((select topic_id from curriculum), 'A'), 1;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_future), (select year_id from curriculum));

grant select on t_late, t_future, t_live, t_closed, t_s1, t_s2, t_admin, curriculum to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_live));
select public.publish_test((select id from t_closed));
select public.publish_test((select id from t_late));
select public.publish_test((select id from t_future));
select test_helpers.as_runner();

select ok(
  position('for update' in lower(pg_get_functiondef('public.start_attempt(uuid,uuid)'::regprocedure)))
    > position('can_access_test' in lower(pg_get_functiondef('public.start_attempt(uuid,uuid)'::regprocedure))),
  'FOR UPDATE is after can_access_test in start_attempt'
);

------------------------------------------------------------------
-- Two students, same open test → two attempts, no duplicates
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_live), '11111111-1111-4111-8111-111111111111'::uuid) as payload
  into temp t_a;
select test_helpers.as_user((select id from t_s2));
select public.start_attempt((select id from t_live), '22222222-2222-4222-8222-222222222222'::uuid) as payload
  into temp t_b;
grant select on t_a, t_b to authenticated;

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.test_attempts where test_id = (select id from t_live)),
  2,
  'two students starting the same test create two attempts'
);
select isnt(
  (select payload ->> 'attempt_id' from t_a),
  (select payload ->> 'attempt_id' from t_b),
  'two students receive distinct attempt ids'
);

------------------------------------------------------------------
-- Duplicate start same student → resume, one live row
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_live), '11111111-1111-4111-8111-111111111111'::uuid) as payload
  into temp t_a2;
grant select on t_a2 to authenticated;
select is(
  (select payload ->> 'attempt_id' from t_a2),
  (select payload ->> 'attempt_id' from t_a),
  'second start same student/device resumes the same attempt'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_live) and student_id = (select id from t_s1)),
  1,
  'partial unique index still prevents duplicate live attempts'
);

select test_helpers.as_user((select id from t_s1));

------------------------------------------------------------------
-- Other device on live attempt
------------------------------------------------------------------
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live),
    '99999999-9999-4999-8999-999999999999'
  ),
  'attempt_locked_other_device',
  'resume from a different device is rejected'
);

------------------------------------------------------------------
-- Late start clamps expires_at to closes_at
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_late), '11111111-1111-4111-8111-111111111111'::uuid) as payload
  into temp t_late_start;
grant select on t_late_start to authenticated;
select ok(
  ((select payload ->> 'expires_at' from t_late_start)::timestamptz)
    <= (select closes_at from public.tests where id = (select id from t_late)),
  'late start expires_at does not outrun closes_at'
);

------------------------------------------------------------------
-- Not yet open / already closed
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_future), '11111111-1111-4111-8111-111111111111'),
  'test_window_closed',
  'start before opens_at is rejected'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_closed));

select test_helpers.as_user((select id from t_s2));
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_closed), '22222222-2222-4222-8222-222222222222'),
  'test_window_closed',
  'new start after close_test_now is rejected'
);

------------------------------------------------------------------
-- Resume while closed (existing in_progress)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_live));

select test_helpers.as_user((select id from t_s1));
select lives_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live),
    '11111111-1111-4111-8111-111111111111'
  ),
  'resume of in_progress after close_test_now still works'
);

------------------------------------------------------------------
-- Access denied (no enrollment / audience)
------------------------------------------------------------------
select test_helpers.as_runner();
create temp table t_s3 as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'lock-scope-c@test.invalid', 'LockScope C', 'student', 'active')
  returning id
) select id from ins;
grant select on t_s3 to authenticated;
select test_helpers.as_user((select id from t_s3));
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live),
    '33333333-3333-4333-8333-333333333333'
  ),
  'test_access_denied',
  'new start with no audience/grant is rejected'
);

------------------------------------------------------------------
-- Submitted then start raises already_submitted
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s2));
select public.submit_attempt(
  ((select payload from t_b) ->> 'attempt_id')::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
);
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live),
    '22222222-2222-4222-8222-222222222222'
  ),
  'already_submitted',
  'start after submit raises already_submitted'
);

------------------------------------------------------------------
-- Expired in_progress lazy-finalize returns already_submitted=true
------------------------------------------------------------------
select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '70 seconds'
where id = ((select payload from t_a) ->> 'attempt_id')::uuid
  and state = 'in_progress';

select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_live), '11111111-1111-4111-8111-111111111111'::uuid) as payload
  into temp t_exp;
grant select on t_exp to authenticated;
select is(
  (select payload ->> 'already_submitted' from t_exp),
  'true',
  'expired resume returns already_submitted=true without raising'
);

select * from finish();
rollback;
