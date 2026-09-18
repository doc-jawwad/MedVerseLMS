-- rank_dirty_queue: dirty signal without tests-row UPDATE.
-- Profile fixtures so this file runs on VPS loadtest (auth.users stub).
begin;
select plan(10);

select test_helpers.as_runner();
select public.rank_dirty_tests();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_s1 as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'dirty-q-a@test.invalid', 'Dirty A', 'student', 'active')
  returning id
) select id from ins;
create temp table t_s2 as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'dirty-q-b@test.invalid', 'Dirty B', 'student', 'active')
  returning id
) select id from ins;
create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'dirty-q-admin@test.invalid', 'Dirty Admin', 'admin', 'active', true)
  returning id
) select id from ins;

insert into public.enrollments (student_id, year_id, status)
values
  ((select id from t_s1), (select year_id from curriculum), 'active'),
  ((select id from t_s2), (select year_id from curriculum), 'active');

create temp table t_test as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP dirty queue', (select year_id from curriculum), 'draft',
    now() - interval '1 minute', now() + interval '2 hours', 60, 0, 1
  ) returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
select (select id from t_test), test_helpers.make_question((select topic_id from curriculum), 'A'), 1;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_test), (select year_id from curriculum));

create temp table t_test2 as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP dirty queue 2', (select year_id from curriculum), 'draft',
    now() - interval '1 minute', now() + interval '2 hours', 60, 0, 1
  ) returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
select (select id from t_test2), test_helpers.make_question((select topic_id from curriculum), 'A'), 1;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_test2), (select year_id from curriculum));

grant select on curriculum, t_s1, t_s2, t_admin, t_test, t_test2 to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_test));
select public.publish_test((select id from t_test2));

select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_test), '11111111-1111-4111-8111-111111111111'::uuid) as payload
  into temp t_a;
select public.submit_attempt(
  ((select payload from t_a) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
) as result into temp t_sub_a;
grant select on t_a, t_sub_a to authenticated;

select is(
  ((select result from t_sub_a) ->> 'score')::numeric,
  0::numeric,
  'one submit still scores immediately'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.rank_dirty_queue where test_id = (select id from t_test)),
  1,
  'one submit inserts one dirty-queue row'
);
select is(
  (select rank_dirty_at from public.tests where id = (select id from t_test)),
  null,
  'score_attempt does not UPDATE tests.rank_dirty_at'
);

select test_helpers.as_user((select id from t_s1));
select public.submit_attempt(
  ((select payload from t_a) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
) as result into temp t_sub_a2;
select is(
  (select result from t_sub_a2),
  (select result from t_sub_a),
  'duplicate submit remains idempotent'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.rank_dirty_queue where test_id = (select id from t_test)),
  1,
  'idempotent submit does not insert a second dirty-queue row'
);

select test_helpers.as_user((select id from t_s2));
select public.start_attempt((select id from t_test), '22222222-2222-4222-8222-222222222222'::uuid) as payload
  into temp t_b;
select public.submit_attempt(
  ((select payload from t_b) ->> 'attempt_id')::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
);
grant select on t_b to authenticated;

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.rank_dirty_queue where test_id = (select id from t_test)),
  2,
  'two same-test submits insert two queue rows'
);

select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_test2), '11111111-1111-4111-8111-111111111111'::uuid) as payload
  into temp t_c;
select public.submit_attempt(
  ((select payload from t_c) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);
grant select on t_c to authenticated;

select test_helpers.as_runner();
select is(
  (select public.rank_dirty_tests()),
  2,
  'rank_dirty_tests coalesces two tests (not one row per submit)'
);
select is(
  (select count(*)::int from public.rank_dirty_queue),
  0,
  'rank_dirty_tests clears the queue'
);
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_test) and state = 'submitted' and rank is not null),
  2,
  'both same-test submits receive a rank after drain'
);

select test_helpers.as_user((select id from t_s1));
select throws_ok(
  'select * from public.rank_dirty_queue',
  'permission denied for table rank_dirty_queue',
  'students cannot read rank_dirty_queue'
);

select * from finish();
rollback;
