-- Resume/expiry: existing in_progress is the same attempt; lazy finalize on
-- overdue rows; submitted/expired paths must not raise session_superseded.

begin;
select plan(12);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_student as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'resume-exp-s@test.invalid', 'Resume Expiry Student', 'student', 'active')
  returning id
) select id from ins;

create temp table t_other as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'resume-exp-o@test.invalid', 'Resume Expiry Other', 'student', 'active')
  returning id
) select id from ins;

create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'resume-exp-a@test.invalid', 'Resume Expiry Admin', 'admin', 'active', true)
  returning id
) select id from ins;

insert into public.enrollments (student_id, year_id, status)
values
  ((select id from t_student), (select year_id from curriculum), 'active'),
  ((select id from t_other), (select year_id from curriculum), 'active');

create temp table t_qid as
select test_helpers.make_question((select topic_id from curriculum), 'A') as id;

create temp table t_free as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions, entitlement
  ) values (
    'PGTAP resume expiry free',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '2 hours',
    60, 0, 1, 'free'
  )
  returning id
) select id from ins;

create temp table t_paid as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions
  ) values (
    'PGTAP resume expiry paid',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '2 hours',
    60, 0, 1
  )
  returning id
) select id from ins;

insert into public.test_questions (test_id, question_id, position)
values
  ((select id from t_free), (select id from t_qid), 1),
  ((select id from t_paid), (select id from t_qid), 1);
insert into public.test_audiences (test_id, year_id)
values
  ((select id from t_free), (select year_id from curriculum)),
  ((select id from t_paid), (select year_id from curriculum));

grant select on curriculum, t_student, t_other, t_admin, t_qid, t_free, t_paid to anon, authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_free));
select public.publish_test((select id from t_paid));
select public.set_resource_entitlement('test', (select id from t_paid), 'any_subscription');

select test_helpers.as_runner();
create temp table t_plan as
select id from public.subscription_plans where is_complimentary = false limit 1;
grant select on t_plan to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.activate_subscription(
  (select id from t_student),
  (select id from t_plan),
  now() - interval '30 days',
  now() + interval '30 days',
  null,
  0
);

------------------------------------------------------------------
-- Same-device resume after paid expiry
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt(
  (select id from t_paid),
  '11111111-1111-4111-8111-111111111111'::uuid
) as payload into temp t_paid_start;
grant select on t_paid_start to authenticated;

select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where student_id = (select id from t_student);

select test_helpers.as_user((select id from t_student));
select lives_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '11111111-1111-4111-8111-111111111111'
  ),
  'same-device resume after subscription expiry still works'
);

select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '99999999-9999-4999-8999-999999999999'
  ),
  'attempt_locked_other_device',
  'second device is still rejected on a live resume'
);

------------------------------------------------------------------
-- Submitted history: start_attempt is already_submitted, not a kick
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.submit_attempt(
  ((select payload from t_paid_start) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);

select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '11111111-1111-4111-8111-111111111111'
  ),
  'already_submitted',
  'submitted history still raises already_submitted'
);

-- Force a non-active JWT session (active_session_id remains null).
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '11111111-1111-4111-8111-111111111111'
  ),
  'already_submitted',
  'stale submitted path does not raise session_superseded'
);

------------------------------------------------------------------
-- Closed test + stale in_progress: list RPC finalizes; start_attempt too
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt(
  (select id from t_free),
  '11111111-1111-4111-8111-111111111111'::uuid
) as payload into temp t_free_start;
grant select on t_free_start to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_free));

select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '70 seconds'
where id = ((select payload from t_free_start) ->> 'attempt_id')::uuid
  and state = 'in_progress';

select test_helpers.as_user((select id from t_student));
select is(
  public.finalize_own_expired_attempts() > 0,
  true,
  'finalize_own_expired_attempts finalizes the caller''s overdue attempt'
);

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts
   where id = ((select payload from t_free_start) ->> 'attempt_id')::uuid),
  'submitted',
  'stale closed in_progress becomes submitted(auto)'
);
select is(
  (select submit_source from public.test_attempts
   where id = ((select payload from t_free_start) ->> 'attempt_id')::uuid),
  'auto',
  'stale closed finalize uses submit_source=auto'
);

select test_helpers.as_user((select id from t_other));
select is(
  public.finalize_own_expired_attempts(),
  0,
  'another student cannot finalize someone else''s overdue attempt'
);

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_free),
    '11111111-1111-4111-8111-111111111111'
  ),
  'already_submitted',
  'expired/closed start_attempt is already_submitted, not a kick'
);

------------------------------------------------------------------
-- Expired resume via start_attempt (no prior list finalize)
------------------------------------------------------------------
select test_helpers.as_runner();
create temp table t_live2 as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions, entitlement
  ) values (
    'PGTAP resume expiry live2',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '2 hours',
    60, 0, 1, 'free'
  )
  returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
values ((select id from t_live2), (select id from t_qid), 1);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_live2), (select year_id from curriculum));
grant select on t_live2 to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_live2));

select test_helpers.as_user((select id from t_student));
select public.start_attempt(
  (select id from t_live2),
  '11111111-1111-4111-8111-111111111111'::uuid
) as payload into temp t_live2_start;
grant select on t_live2_start to authenticated;

select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '70 seconds'
where id = ((select payload from t_live2_start) ->> 'attempt_id')::uuid;

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select public.start_attempt(
  (select id from t_live2),
  '99999999-9999-4999-8999-999999999999'::uuid
) as payload into temp t_exp_resume;
grant select on t_exp_resume to authenticated;

select is(
  (select payload from t_exp_resume) ->> 'already_submitted',
  'true',
  'expired attempt lazy-finalizes even from another device/session'
);

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts
   where id = ((select payload from t_live2_start) ->> 'attempt_id')::uuid),
  'submitted',
  'expired resume actually submitted the existing row'
);

------------------------------------------------------------------
-- Live resume still requires an active session
------------------------------------------------------------------
select test_helpers.as_runner();
create temp table t_live3 as
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions, entitlement
  ) values (
    'PGTAP resume expiry live3',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '2 hours',
    60, 0, 1, 'free'
  )
  returning id
) select id from ins;
insert into public.test_questions (test_id, question_id, position)
values ((select id from t_live3), (select id from t_qid), 1);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_live3), (select year_id from curriculum));
grant select on t_live3 to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_live3));

select test_helpers.as_user((select id from t_student));
select public.start_attempt(
  (select id from t_live3),
  '11111111-1111-4111-8111-111111111111'::uuid
);

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live3),
    '11111111-1111-4111-8111-111111111111'
  ),
  'session_superseded',
  'live in_progress resume still raises session_superseded when the session is not active'
);

select * from finish();
rollback;
