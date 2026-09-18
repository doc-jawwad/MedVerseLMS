-- 8J-B: historical own submitted result ownership. Transaction-scoped.

begin;
select plan(22);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Result Owner') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'Result Other') as id
  into temp t_other;
select test_helpers.make_admin('Result Admin') as id into temp t_admin;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_paid;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_free;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_progress;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

update public.tests
  set show_review = 'after_submit'
  where id in ((select id from t_paid), (select id from t_free));

grant select on curriculum, t_student, t_other, t_admin, t_paid, t_free, t_progress, t_std
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
-- Sit paid + free; leave one in_progress
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_paid), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0101'::uuid)
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
  aid, qv, 'A', false, ordinality::bigint, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0101'::uuid
) from t_q_paid;
select public.submit_attempt(
  (select aid from t_q_paid limit 1), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0101'::uuid
) as paid_result into temp t_paid_result;
grant select on t_paid_result to authenticated;

select public.start_attempt((select id from t_free), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0102'::uuid)
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
  aid, qv, 'A', false, ordinality::bigint, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0102'::uuid
) from t_q_free;
select public.submit_attempt(
  (select aid from t_q_free limit 1), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0102'::uuid
);

select public.start_attempt((select id from t_progress), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0103'::uuid)
  as payload into temp t_start_progress;
grant select on t_start_progress to authenticated;

select
  (select (paid_result ->> 'score')::numeric from t_paid_result) as score,
  (select rank from public.test_attempts where id = (select aid from t_q_paid limit 1)) as rank
into temp t_snapshot;
grant select on t_snapshot to authenticated;

------------------------------------------------------------------
-- 1) Own submitted result allowed
------------------------------------------------------------------
select ok(
  public.get_own_test_result((select id from t_paid)) is not null
  and public.get_own_test_result((select id from t_paid)) -> 'test' ->> 'title' is not null
  and (public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'id')::uuid
      = (select aid from t_q_paid limit 1)
  and (public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'score')::numeric
      = (select score from t_snapshot)
  and public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'percentage' is not null
  and public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'state' = 'submitted'
  and public.get_own_test_result((select id from t_paid)) -> 'attempt' ? 'rank',
  '1 own submitted result summary is returned'
);

select ok(
  public.get_own_test_result((select id from t_paid))::text not like '%stem%'
  and public.get_own_test_result((select id from t_paid))::text not like '%correct_key%'
  and public.get_own_test_result((select id from t_paid))::text not like '%selected_key%'
  and public.get_own_test_result((select id from t_paid))::text not like '%explanation%'
  and public.get_own_test_result((select id from t_paid))::text not like '%question_order%'
  and (public.get_own_test_result((select id from t_paid)) -> 'items') is null,
  '1b own-result RPC does not return protected review payload'
);

------------------------------------------------------------------
-- 2) Another student's result denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select ok(
  public.get_own_test_result((select id from t_paid)) is null
  and public.get_own_test_result((select id from t_free)) is null,
  '2 other student cannot load owner historical result by test id'
);

------------------------------------------------------------------
-- 3) Non-submitted / in_progress denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.get_own_test_result((select id from t_progress)) is null,
  '3 in_progress-only attempt does not return a result'
);

select ok(
  public.get_own_test_result(gen_random_uuid()) is null,
  '3b test with no submitted attempt returns null'
);

------------------------------------------------------------------
-- 4) Arbitrary attempt id cannot bypass ownership
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select ok(
  public.get_own_test_result((select aid from t_q_paid limit 1)) is null,
  '4 passing an attempt id as p_test_id does not return another student result'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.get_own_test_result((select aid from t_q_paid limit 1)) is null,
  '4b owner also cannot use attempt id in place of test id'
);

------------------------------------------------------------------
-- Invalidated history + later submitted (while still on the original year)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.invalidate_attempt((select aid from t_q_free limit 1), 'device failure');

select test_helpers.as_user((select id from t_student));
select public.start_attempt((select id from t_free), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0104'::uuid)
  as payload into temp t_retake;
grant select on t_retake to authenticated;
select
  ((select payload from t_retake) ->> 'attempt_id')::uuid as aid
into temp t_retake_aid;
grant select on t_retake_aid to authenticated;
select public.submit_attempt(
  (select aid from t_retake_aid), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0104'::uuid
);

select ok(
  (public.get_own_test_result((select id from t_free)) -> 'attempt' ->> 'id')::uuid
    = (select aid from t_retake_aid)
  and jsonb_array_length(public.get_own_test_result((select id from t_free)) -> 'invalidated') = 1
  and public.get_own_test_result((select id from t_free)) -> 'invalidated' -> 0 ->> 'invalidated_reason'
      = 'device failure',
  'invalidated history is listed beside the current submitted result'
);

------------------------------------------------------------------
-- 5) Year change does not block own historical result
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.promote_student((select id from t_student));

select test_helpers.as_user((select id from t_student));
select ok(
  not public.can_view_test((select id from t_paid))
  and not public.can_view_test((select id from t_free)),
  '5 after year change current catalog no longer lists the old-year tests'
);
select is(
  (select count(*)::int from public.tests where id = (select id from t_paid)),
  0,
  '5b tests SELECT via can_view_test is empty after year change'
);
select ok(
  public.get_own_test_result((select id from t_paid)) is not null
  and (public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'score')::numeric
      = (select score from t_snapshot)
  and public.get_own_test_result((select id from t_paid)) -> 'test' ->> 'title' is not null,
  '5c own historical result still loads after year change'
);

------------------------------------------------------------------
-- 6 / 8) Subscription expiry: summary remains, review stays locked
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.set_subscription_end((select id from t_sub), now() - interval '1 hour');

select test_helpers.as_user((select id from t_student));
select ok(
  public.get_own_test_result((select id from t_paid)) is not null
  and (public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'score')::numeric
      = (select score from t_snapshot)
  and (public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'id')::uuid
      = (select aid from t_q_paid limit 1),
  '6 expiry does not block own result summary'
);
select is(
  public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'reason',
  'review_locked_entitlement',
  '8 protected review remains locked after expiry'
);
select ok(
  (public.get_attempt_review((select aid from t_q_paid limit 1)) -> 'items') is null
  and public.get_attempt_review((select aid from t_q_paid limit 1))::text
        not like '%correct_key%'
  and public.get_attempt_review((select aid from t_q_paid limit 1))::text
        not like '%stem%',
  '8b expired review payload has no protected fields'
);
select is(
  (select score from public.test_attempts where id = (select aid from t_q_paid limit 1)),
  (select score from t_snapshot),
  '6b expiry does not rescore'
);

------------------------------------------------------------------
-- Archived / closed still owned
------------------------------------------------------------------
select test_helpers.as_runner();
update public.tests set status = 'archived' where id = (select id from t_paid);
update public.tests set status = 'closed' where id = (select id from t_free);

select test_helpers.as_user((select id from t_student));
select ok(
  not public.can_view_test((select id from t_paid))
  and public.get_own_test_result((select id from t_paid)) is not null,
  'archived test still returns own submitted summary'
);
select ok(
  public.get_own_test_result((select id from t_free)) is not null,
  'closed test still returns own submitted summary'
);

------------------------------------------------------------------
-- 7) Admin behavior preserved
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select is(
  (select count(*)::int from public.tests where id = (select id from t_paid)),
  1,
  '7 admin can still SELECT the historical test row'
);
select ok(
  (select count(*)::int from public.test_attempts
    where id = (select aid from t_q_paid limit 1)) = 1,
  '7b admin SELECT on the student attempt remains'
);
select ok(
  (public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'allowed') = 'true',
  '7c admin review access remains'
);
select ok(
  public.get_own_test_result((select id from t_paid)) is null,
  '7d get_own_test_result stays caller-owned and does not leak student results to admin'
);

------------------------------------------------------------------
-- Renewal: summary unchanged; review unlocks (8J-A)
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
select test_helpers.as_runner();
update public.tests set status = 'published' where id = (select id from t_paid);

select test_helpers.as_user((select id from t_student));
select ok(
  public.get_own_test_result((select id from t_paid)) is not null
  and (public.get_own_test_result((select id from t_paid)) -> 'attempt' ->> 'score')::numeric
      = (select score from t_snapshot)
  and (public.get_attempt_review((select aid from t_q_paid limit 1)) ->> 'allowed') = 'true',
  'renewal keeps historical summary and restores review per 8J-A'
);

select * from finish();
rollback;
