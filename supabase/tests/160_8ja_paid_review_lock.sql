-- 8J-A: paid review lock + attempt_answers RLS. Transaction-scoped.

begin;
select plan(19);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Review Owner') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'Review Other') as id
  into temp t_other;
select test_helpers.make_admin('Review Admin') as id into temp t_admin;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_paid;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_free;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

update public.tests
  set show_review = 'after_submit'
  where id in ((select id from t_paid), (select id from t_free));

grant select on curriculum, t_student, t_other, t_admin, t_paid, t_free, t_std
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement('test', (select id from t_paid), 'any_subscription');
select public.activate_subscription(
  (select id from t_student),
  (select id from t_std),
  now() - interval '30 days',
  now() + interval '30 days',
  null,
  0
) as id into temp t_sub;
grant select on t_sub to authenticated;

------------------------------------------------------------------
-- Sit paid + free papers while entitled
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_paid), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid)
  as payload into temp t_start_paid;
grant select on t_start_paid to authenticated;

select
  ((select payload from t_start_paid) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_q_paid
from jsonb_array_elements((select payload from t_start_paid) -> 'questions') with ordinality;
grant select on t_q_paid to authenticated;

select public.save_answer(
  aid, qv, 'A', false, ordinality::bigint, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid
) from t_q_paid;
select public.submit_attempt(
  (select aid from t_q_paid limit 1), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid
) as paid_result into temp t_paid_result;
grant select on t_paid_result to authenticated;

select public.start_attempt((select id from t_free), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002'::uuid)
  as payload into temp t_start_free;
grant select on t_start_free to authenticated;
select
  ((select payload from t_start_free) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_q_free
from jsonb_array_elements((select payload from t_start_free) -> 'questions') with ordinality;
grant select on t_q_free to authenticated;
select public.save_answer(
  aid, qv, 'A', false, ordinality::bigint, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002'::uuid
) from t_q_free;
select public.submit_attempt(
  (select aid from t_q_free limit 1), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002'::uuid
);

select
  (select (paid_result ->> 'score')::numeric from t_paid_result) as score,
  (select rank from public.test_attempts where id = (select aid from t_q_paid limit 1)) as rank
into temp t_snapshot;
grant select on t_snapshot to authenticated;

------------------------------------------------------------------
-- 1) Live paid entitlement can obtain review items
------------------------------------------------------------------
select ok(
  (public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'allowed') = 'true'
  and jsonb_array_length(public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items') = 2
  and (public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items' -> 0 ? 'stem')
  and (public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items' -> 0 ? 'correct_key'),
  '1 live paid entitlement returns allowed review items'
);

------------------------------------------------------------------
-- 2 / 3) Expire → deny payload; never-entitled other student denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.set_subscription_end((select id from t_sub), now() - interval '1 hour');

select test_helpers.as_user((select id from t_student));
select is(
  public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'reason',
  'review_locked_entitlement',
  '2 expired paid entitlement is denied with review_locked_entitlement'
);
select ok(
  (public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'allowed') = 'false'
  and (public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items') is null
  and (public.get_attempt_review((select aid from t_q_paid limit 1))::text)
        not like '%correct_key%'
  and (public.get_attempt_review((select aid from t_q_paid limit 1))::text)
        not like '%selected_key%'
  and (public.get_attempt_review((select aid from t_q_paid limit 1))::text)
        not like '%explanation%'
  and (public.get_attempt_review((select aid from t_q_paid limit 1))::text)
        not like '%stem%',
  '2b denied paid review contains no protected fields'
);

select test_helpers.as_user((select id from t_other));
select throws_ok(
  format('select public.get_attempt_review(%L)', (select aid from t_q_paid limit 1)),
  'attempt_not_found',
  '3 never-entitled other student cannot read this attempt review'
);

------------------------------------------------------------------
-- 4 / 5) Direct SELECT attempt_answers denied for owner and other
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.attempt_answers
    where attempt_id = (select aid from t_q_paid limit 1)),
  0,
  '4 owner cannot SELECT attempt_answers after submit (no review bypass)'
);

select test_helpers.as_user((select id from t_other));
select is(
  (select count(*)::int from public.attempt_answers
    where attempt_id = (select aid from t_q_paid limit 1)),
  0,
  '5 other student cannot SELECT owner attempt_answers'
);

------------------------------------------------------------------
-- 6) Admin review + admin SELECT remain
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select ok(
  (public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'allowed') = 'true'
  and jsonb_array_length(public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items') = 2,
  '6 admin can obtain review while student is expired'
);
select ok(
  (select count(*)::int from public.attempt_answers
    where attempt_id = (select aid from t_q_paid limit 1)) >= 1,
  '6b admin SELECT on attempt_answers still works'
);

------------------------------------------------------------------
-- 7) Free-test review still follows show_review (no paid gate)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  (public.get_attempt_review((select aid from t_q_free limit 1)) ->> 'allowed') = 'true'
  and jsonb_array_length(public.get_attempt_review((select aid from t_q_free limit 1)) -> 'items') = 2,
  '7 free-test review remains allowed without a live subscription'
);

select test_helpers.as_runner();
update public.tests set show_review = 'never' where id = (select id from t_free);
select test_helpers.as_user((select id from t_student));
select is(
  public.get_attempt_review((select aid from t_q_free limit 1)) ->> 'reason',
  'review_disabled',
  '7b free-test show_review=never still disables review'
);
select test_helpers.as_runner();
update public.tests set show_review = 'after_submit' where id = (select id from t_free);

------------------------------------------------------------------
-- Historical rows unchanged after lock
------------------------------------------------------------------
select is(
  (select score from public.test_attempts where id = (select aid from t_q_paid limit 1)),
  (select score from t_snapshot),
  'expiry does not change stored score'
);
select is(
  (select rank from public.test_attempts where id = (select aid from t_q_paid limit 1)),
  (select rank from t_snapshot),
  'expiry does not rewrite rank'
);
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_paid) and student_id = (select id from t_student)),
  1,
  'expiry does not duplicate the attempt'
);

------------------------------------------------------------------
-- 11) Renew restores review; history still unchanged
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.activate_subscription(
  (select id from t_student),
  (select id from t_std),
  now(),
  now() + interval '20 days',
  null,
  0
);

select test_helpers.as_user((select id from t_student));
select ok(
  (public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'allowed') = 'true'
  and jsonb_array_length(public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items') = 2,
  '11 renewal restores paid review items'
);
select is(
  (select score from public.test_attempts where id = (select aid from t_q_paid limit 1)),
  (select score from t_snapshot),
  'renewal does not change stored score'
);
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_paid) and student_id = (select id from t_student)),
  1,
  'renewal does not duplicate the attempt'
);

------------------------------------------------------------------
-- Never-subscribed student sitting a free test cannot review a paid paper
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select public.start_attempt((select id from t_free), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001'::uuid)
  as payload into temp t_other_free;
grant select on t_other_free to authenticated;
select
  ((select payload from t_other_free) ->> 'attempt_id')::uuid as aid
into temp t_other_free_aid;
grant select on t_other_free_aid to authenticated;
select throws_ok(
  format('select public.get_attempt_review(%L)', (select aid from t_q_paid limit 1)),
  'attempt_not_found',
  '3b never-paid peer still cannot open the paid attempt'
);

------------------------------------------------------------------
-- No-subscription owner of a paid attempt (activate never happened for other)
-- Sit paid without entitlement is blocked; cover get_attempt_review after
-- a grant-less paid sit by inserting as runner (historical row) then lock.
------------------------------------------------------------------
select test_helpers.as_runner();
create temp table t_other_paid as
with ins as (
  insert into public.test_attempts (
    test_id, student_id, state, expires_at, submitted_at, submit_source,
    device_id, question_order, score, max_score, percentage,
    raw_correct, raw_wrong, raw_blank
  )
  select
    (select id from t_paid),
    (select id from t_other),
    'submitted',
    now(),
    now(),
    'student',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0002'::uuid,
    (select question_order from public.test_attempts where id = (select aid from t_q_paid limit 1)),
    2, 2, 100, 2, 0, 0
  returning id
)
select id from ins;
grant select on t_other_paid to authenticated;

select test_helpers.as_user((select id from t_other));
select is(
  public.get_attempt_review((select id from t_other_paid)) ->> 'reason',
  'review_locked_entitlement',
  '3c submitted paid attempt without live entitlement is locked'
);
select ok(
  (public.get_attempt_review((select id from t_other_paid)) -> 'items') is null,
  '3d unpaid paid-review payload has no items'
);

select * from finish();
rollback;
