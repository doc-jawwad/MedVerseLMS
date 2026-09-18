-- Close → expiry → lazy-finalize → get_own_test_result.
-- Profiles inserted directly so this file runs on VPS staging (auth.users stub).

begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_student as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'lazy-fin-student@test.invalid', 'Lazy Finalize Student', 'student', 'active')
  returning id
) select id from ins;

create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'lazy-fin-admin@test.invalid', 'Lazy Finalize Admin', 'admin', 'active', true)
  returning id
) select id from ins;

insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select year_id from curriculum), 'active');

create temp table t_qid as
select test_helpers.make_question((select topic_id from curriculum), 'A') as id;

create temp table t_test as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions, entitlement
  ) values (
    'PGTAP lazy finalize',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '2 hours',
    60, 0, 1, 'free'
  )
  returning id
) select id from ins;

insert into public.test_questions (test_id, question_id, position)
values ((select id from t_test), (select id from t_qid), 1);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_test), (select year_id from curriculum));

grant select on curriculum, t_student, t_admin, t_qid, t_test to anon, authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_test));
select test_helpers.as_runner();

select test_helpers.as_runner();
create temp table t_start (payload jsonb);
create temp table t_expired (payload jsonb);
grant all on t_start, t_expired to authenticated;

select test_helpers.as_user((select id from t_student));
insert into t_start
select public.start_attempt(
  (select id from t_test),
  '11111111-1111-4111-8111-111111111111'::uuid
);

select test_helpers.as_runner();
create temp table t_aid as
select ((select payload from t_start) ->> 'attempt_id')::uuid as aid;
grant select on t_aid to authenticated;

select is(
  (select state from public.test_attempts where id = (select aid from t_aid)),
  'in_progress',
  'attempt is in_progress before close'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_test));

select test_helpers.as_runner();
select is(
  (select status from public.tests where id = (select id from t_test)),
  'closed',
  'close_test_now marks the test closed'
);
select ok(
  (select expires_at from public.test_attempts where id = (select aid from t_aid))
    <= (select closes_at from public.tests where id = (select id from t_test)),
  'close clamps in_progress expires_at'
);
select is(
  (select state from public.test_attempts where id = (select aid from t_aid)),
  'in_progress',
  'close does not submit or delete the attempt'
);

update public.test_attempts
set expires_at = now() - interval '70 seconds'
where id = (select aid from t_aid);

select test_helpers.as_user((select id from t_student));
insert into t_expired
select public.start_attempt(
  (select id from t_test),
  '11111111-1111-4111-8111-111111111111'::uuid
);

select is(
  (select payload from t_expired) ->> 'already_submitted',
  'true',
  'expired resume after close returns already_submitted=true without raising'
);

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts where id = (select aid from t_aid)),
  'submitted',
  'lazy-finalize commits submitted'
);
select is(
  (select submit_source from public.test_attempts where id = (select aid from t_aid)),
  'auto',
  'lazy-finalize uses submit_source=auto'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.get_own_test_result((select id from t_test)) is not null
  and (public.get_own_test_result((select id from t_test)) -> 'attempt' ->> 'id')::uuid
    = (select aid from t_aid)
  and public.get_own_test_result((select id from t_test)) -> 'attempt' ->> 'state' = 'submitted',
  'owner can load get_own_test_result after close + expiry + lazy-finalize'
);

select test_helpers.as_runner();
create temp table t_before_second as
select state, submitted_at, submit_source, score
from public.test_attempts
where id = (select aid from t_aid);
grant select on t_before_second to authenticated;

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_test),
    '11111111-1111-4111-8111-111111111111'
  ),
  'already_submitted',
  'second start_attempt after lazy-finalize raises already_submitted'
);

select test_helpers.as_runner();
select ok(
  (select state from public.test_attempts where id = (select aid from t_aid))
    = (select state from t_before_second)
  and (select submitted_at from public.test_attempts where id = (select aid from t_aid))
    is not distinct from (select submitted_at from t_before_second)
  and (select submit_source from public.test_attempts where id = (select aid from t_aid))
    is not distinct from (select submit_source from t_before_second)
  and (select score from public.test_attempts where id = (select aid from t_aid))
    is not distinct from (select score from t_before_second),
  'already-submitted start_attempt does not mutate the row'
);

select * from finish();
rollback;
