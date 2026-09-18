-- 8J-C: close_test_now clamp + resume-while-closed. Transaction-scoped.

begin;
select plan(48);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'C1') as id
  into temp t_s1;
select test_helpers.make_student((select year_id from curriculum), 'C2') as id
  into temp t_s2;
select test_helpers.make_student((select year_id from curriculum), 'C3') as id
  into temp t_s3;
select test_helpers.make_admin('C Admin') as id into temp t_admin;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_empty;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_live;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_many;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_term;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_new;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_race_a;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_race_b;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 3, 60, 0
) as id into temp t_blank;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_rank;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_paid;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_repeat;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on
  curriculum, t_s1, t_s2, t_s3, t_admin, t_empty, t_live, t_many, t_term, t_new,
  t_race_a, t_race_b, t_blank, t_rank, t_paid, t_repeat, t_std
  to authenticated;

------------------------------------------------------------------
-- 1) Close with no active attempts
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.close_test_now(%L)', (select id from t_empty)),
  'close_test_now succeeds with no attempts'
);

select test_helpers.as_runner();
select is(
  (select status from public.tests where id = (select id from t_empty)),
  'closed',
  'empty close sets status=closed'
);
select ok(
  (select closes_at <= now() and closes_at >= now() - interval '5 seconds'
   from public.tests where id = (select id from t_empty)),
  'empty close sets closes_at to now'
);
select is(
  (select count(*)::int from public.audit_logs
   where action = 'test_closed_now' and target_id = (select id from t_empty)),
  1,
  'close writes test_closed_now audit'
);
select is(
  (select count(*)::int from public.test_attempts where test_id = (select id from t_empty)),
  0,
  'close with no attempts creates no attempt rows'
);

------------------------------------------------------------------
-- 2–5) One in-progress: clamp future expires_at, same row/device
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_live), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_start_live;
grant select on t_start_live to authenticated;

select
  ((select payload from t_start_live) ->> 'attempt_id')::uuid as aid,
  ((select payload from t_start_live) ->> 'expires_at')::timestamptz as orig_exp,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_live_q
from jsonb_array_elements((select payload from t_start_live) -> 'questions') with ordinality;
grant select on t_live_q to authenticated;

select public.save_answer(
  (select aid from t_live_q limit 1),
  (select qv from t_live_q where ordinality = 1),
  'A', false, 1, '11111111-1111-4111-8111-111111111111'::uuid
);

select test_helpers.as_runner();
select ok(
  (select orig_exp from t_live_q limit 1) > now() + interval '30 minutes',
  'sanity: live attempt originally expires in the future'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.close_test_now(%L)', (select id from t_live)),
  'close_test_now with one in_progress attempt'
);

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts where id = (select aid from t_live_q limit 1)),
  'in_progress',
  'close-now does not force-submit'
);
select is(
  (select id from public.test_attempts where id = (select aid from t_live_q limit 1)),
  (select aid from t_live_q limit 1),
  'close-now keeps the same attempt row'
);
select is(
  (select device_id from public.test_attempts where id = (select aid from t_live_q limit 1)),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'close-now does not change device binding'
);
select ok(
  (select ta.expires_at <= t.closes_at
   from public.test_attempts ta
   join public.tests t on t.id = ta.test_id
   where ta.id = (select aid from t_live_q limit 1)),
  'clamped expires_at <= close timestamp'
);
select ok(
  (select ta.expires_at >= t.closes_at - interval '1 second'
   from public.test_attempts ta
   join public.tests t on t.id = ta.test_id
   where ta.id = (select aid from t_live_q limit 1)),
  'future expires_at is clamped to closes_at, not left later'
);
select is(
  (select count(*)::int from public.test_attempts where test_id = (select id from t_live)),
  1,
  'close-now does not create a new attempt'
);

------------------------------------------------------------------
-- 5b) Preserve already-earlier expires_at (separate many-test student)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_many), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_start_many1;
select test_helpers.as_user((select id from t_s2));
select public.start_attempt((select id from t_many), '22222222-2222-4222-8222-222222222222'::uuid)
  as payload into temp t_start_many2;
select test_helpers.as_user((select id from t_s3));
select public.start_attempt((select id from t_many), '33333333-3333-4333-8333-333333333333'::uuid)
  as payload into temp t_start_many3;
grant select on t_start_many1, t_start_many2, t_start_many3 to authenticated;

select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '12 seconds'
where id = ((select payload from t_start_many3) ->> 'attempt_id')::uuid;
select ((select payload from t_start_many3) ->> 'attempt_id')::uuid as aid,
       (select expires_at from public.test_attempts
        where id = ((select payload from t_start_many3) ->> 'attempt_id')::uuid) as early_exp
into temp t_early;
grant select on t_early to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_many));

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.test_attempts
   where test_id = (select id from t_many) and state = 'in_progress'
     and expires_at <= (select closes_at from public.tests where id = (select id from t_many))),
  3,
  'every in_progress attempt on the test is clamped to <= closes_at'
);
select is(
  (select expires_at from public.test_attempts where id = (select aid from t_early)),
  (select early_exp from t_early),
  'already-earlier expires_at is not moved later'
);

------------------------------------------------------------------
-- 6–7) Submitted and invalidated are not rewritten
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_term), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_start_term1;
grant select on t_start_term1 to authenticated;
select public.submit_attempt(
  ((select payload from t_start_term1) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);

select test_helpers.as_user((select id from t_s2));
select public.start_attempt((select id from t_term), '22222222-2222-4222-8222-222222222222'::uuid)
  as payload into temp t_start_term2;
grant select on t_start_term2 to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.invalidate_attempt(
  ((select payload from t_start_term2) ->> 'attempt_id')::uuid,
  'device failure'
);

select test_helpers.as_runner();
select expires_at as exp, state into temp t_sub_snap
from public.test_attempts
where id = ((select payload from t_start_term1) ->> 'attempt_id')::uuid;
select expires_at as exp, state into temp t_inv_snap
from public.test_attempts
where id = ((select payload from t_start_term2) ->> 'attempt_id')::uuid;
grant select on t_sub_snap, t_inv_snap to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_term));

select test_helpers.as_runner();
select is(
  (select exp from t_sub_snap),
  (select expires_at from public.test_attempts
   where id = ((select payload from t_start_term1) ->> 'attempt_id')::uuid),
  'submitted attempt expires_at is unchanged by close-now'
);
select is(
  (select state from public.test_attempts
   where id = ((select payload from t_start_term1) ->> 'attempt_id')::uuid),
  'submitted',
  'submitted attempt state is unchanged by close-now'
);
select is(
  (select exp from t_inv_snap),
  (select expires_at from public.test_attempts
   where id = ((select payload from t_start_term2) ->> 'attempt_id')::uuid),
  'invalidated attempt expires_at is unchanged by close-now'
);
select is(
  (select state from public.test_attempts
   where id = ((select payload from t_start_term2) ->> 'attempt_id')::uuid),
  'invalidated',
  'invalidated attempt state is unchanged by close-now'
);

------------------------------------------------------------------
-- 8) New start after close denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_new));

select test_helpers.as_user((select id from t_s1));
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_new),
    '11111111-1111-4111-8111-111111111111'
  ),
  'test_window_closed',
  'new start after close-now is denied'
);

------------------------------------------------------------------
-- 9–10) Same-device resume works; other device denied
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_live), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_resume_live;
grant select on t_resume_live to authenticated;

select is(
  ((select payload from t_resume_live) ->> 'attempt_id')::uuid,
  (select aid from t_live_q limit 1),
  'same-device resume after close returns the existing attempt'
);
select is(
  (select jsonb_array_length((select payload from t_resume_live) -> 'answers')),
  1,
  'resume after close restores saved answers'
);
select ok(
  ((select payload from t_resume_live) ->> 'expires_at')::timestamptz
    <= (select closes_at from public.tests where id = (select id from t_live)),
  'resume payload exposes the clamped expires_at'
);

select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live),
    '99999999-9999-4999-8999-999999999999'
  ),
  'attempt_locked_other_device',
  'other-device resume after close is denied'
);

------------------------------------------------------------------
-- 11) Expired resume finalizes through existing expiry path
------------------------------------------------------------------
select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '70 seconds'
where id = (select aid from t_live_q limit 1);

select test_helpers.as_user((select id from t_s1));
select public.start_attempt(
  (select id from t_live),
  '11111111-1111-4111-8111-111111111111'::uuid
) as payload into temp t_expired_resume;
grant select on t_expired_resume to authenticated;

select is(
  (select payload from t_expired_resume) ->> 'already_submitted',
  'true',
  'expired resume after close returns already_submitted=true on the committed row'
);

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts where id = (select aid from t_live_q limit 1)),
  'submitted',
  'expired resume actually submitted the existing row'
);
select is(
  (select submit_source from public.test_attempts where id = (select aid from t_live_q limit 1)),
  'auto',
  'expired resume uses submit_source=auto'
);

select test_helpers.as_user((select id from t_s1));
select ok(
  public.get_own_test_result((select id from t_live)) is not null
  and (public.get_own_test_result((select id from t_live)) -> 'attempt' ->> 'id')::uuid
    = (select aid from t_live_q limit 1)
  and public.get_own_test_result((select id from t_live)) -> 'attempt' ->> 'state' = 'submitted',
  'get_own_test_result returns the owner result after close + expiry + lazy-finalize'
);
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_live),
    '11111111-1111-4111-8111-111111111111'
  ),
  'already_submitted',
  'second start_attempt after close+lazy-finalize raises already_submitted'
);

------------------------------------------------------------------
-- 12–13) save within / after transport grace (authoritative expires_at)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_blank), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_start_blank;
grant select on t_start_blank to authenticated;
select
  ((select payload from t_start_blank) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_blank_q
from jsonb_array_elements((select payload from t_start_blank) -> 'questions') with ordinality;
grant select on t_blank_q to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_blank));

select test_helpers.as_user((select id from t_s1));
select lives_ok(
  format(
    'select public.save_answer(%L, %L, ''A'', false, 1, %L)',
    (select aid from t_blank_q limit 1),
    (select qv from t_blank_q where ordinality = 1),
    '11111111-1111-4111-8111-111111111111'
  ),
  'save_answer within 30s of clamped expires_at still succeeds'
);

select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '31 seconds'
where id = (select aid from t_blank_q limit 1);

select test_helpers.as_user((select id from t_s1));
select throws_ok(
  format(
    'select public.save_answer(%L, %L, ''B'', false, 2, %L)',
    (select aid from t_blank_q limit 1),
    (select qv from t_blank_q where ordinality = 1),
    '11111111-1111-4111-8111-111111111111'
  ),
  'attempt_expired',
  'save_answer after transport grace fails against clamped expires_at'
);

------------------------------------------------------------------
-- 14) submit remains idempotent after close
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s2));
select public.start_attempt((select id from t_race_a), '22222222-2222-4222-8222-222222222222'::uuid)
  as payload into temp t_start_race_a;
grant select on t_start_race_a to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_race_a));

select test_helpers.as_user((select id from t_s2));
select public.submit_attempt(
  ((select payload from t_start_race_a) ->> 'attempt_id')::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
) as result into temp t_sub_a;
select public.submit_attempt(
  ((select payload from t_start_race_a) ->> 'attempt_id')::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
) as result into temp t_sub_a2;
grant select on t_sub_a, t_sub_a2 to authenticated;

select is(
  (select result from t_sub_a2),
  (select result from t_sub_a),
  'submit_attempt after close is idempotent'
);
select is(
  (select count(*)::int from public.test_attempts where test_id = (select id from t_race_a)),
  1,
  'close then submit leaves exactly one attempt'
);

------------------------------------------------------------------
-- 15) close vs submit (both orders) → one submitted row
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_race_b), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_start_race_b;
grant select on t_start_race_b to authenticated;
select public.submit_attempt(
  ((select payload from t_start_race_b) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);

select test_helpers.as_runner();
select expires_at as exp into temp t_race_b_exp
from public.test_attempts
where id = ((select payload from t_start_race_b) ->> 'attempt_id')::uuid;
grant select on t_race_b_exp to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_race_b));

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts
   where id = ((select payload from t_start_race_b) ->> 'attempt_id')::uuid),
  'submitted',
  'submit then close leaves the attempt submitted'
);
select is(
  (select count(*)::int from public.test_attempts where test_id = (select id from t_race_b)),
  1,
  'submit then close does not create a second attempt'
);
select is(
  (select expires_at from public.test_attempts
   where id = ((select payload from t_start_race_b) ->> 'attempt_id')::uuid),
  (select exp from t_race_b_exp),
  'submit then close does not rewrite submitted expires_at'
);

------------------------------------------------------------------
-- 16) Unanswered questions score zero after auto-submit
------------------------------------------------------------------
select test_helpers.as_runner();
update public.test_attempts
set expires_at = now() - interval '70 seconds'
where id = (select aid from t_blank_q limit 1) and state = 'in_progress';

select public.auto_submit_expired();

select is(
  (select state from public.test_attempts where id = (select aid from t_blank_q limit 1)),
  'submitted',
  'auto_submit_expired finalizes the clamped blank attempt'
);
select is(
  (select raw_blank from public.test_attempts where id = (select aid from t_blank_q limit 1)),
  2,
  'unanswered questions are blank after auto-submit (one saved, two blank of 3)'
);
select is(
  (select score from public.test_attempts where id = (select aid from t_blank_q limit 1))::numeric,
  1::numeric,
  'saved correct answer scores; blanks contribute zero (not wrong)'
);
select is(
  (select raw_wrong from public.test_attempts where id = (select aid from t_blank_q limit 1)),
  0,
  'blanks are not marked wrong'
);

------------------------------------------------------------------
-- 17) Rank remains submitted-only
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s1));
select public.start_attempt((select id from t_rank), '11111111-1111-4111-8111-111111111111'::uuid)
  as payload into temp t_start_rank1;
select public.submit_attempt(
  ((select payload from t_start_rank1) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);
select test_helpers.as_user((select id from t_s2));
select public.start_attempt((select id from t_rank), '22222222-2222-4222-8222-222222222222'::uuid)
  as payload into temp t_start_rank2;
grant select on t_start_rank1, t_start_rank2 to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_rank));

select test_helpers.as_runner();
select public.rank_test((select id from t_rank));
select isnt(
  (select rank from public.test_attempts
   where id = ((select payload from t_start_rank1) ->> 'attempt_id')::uuid),
  null,
  'submitted attempt is ranked after close-now'
);
select is(
  (select rank from public.test_attempts
   where id = ((select payload from t_start_rank2) ->> 'attempt_id')::uuid),
  null,
  'in_progress attempt is not ranked after close-now'
);

------------------------------------------------------------------
-- 18) Subscription expiry during live exam still follows live-attempt law
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement('test', (select id from t_paid), 'any_subscription');
select public.activate_subscription(
  (select id from t_s1),
  (select id from t_std),
  now() - interval '30 days',
  now() + interval '30 days',
  null,
  0
) as id into temp t_sub;
grant select on t_sub to authenticated;

select test_helpers.as_user((select id from t_s1));
select lives_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '11111111-1111-4111-8111-111111111111'
  ),
  'entitled student can start a paid test'
);

select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where id = (select id from t_sub);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_paid));

select test_helpers.as_user((select id from t_s1));
select lives_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '11111111-1111-4111-8111-111111111111'
  ),
  'resume after paid expiry and close-now still works on the same device'
);

select test_helpers.as_user((select id from t_s2));
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_paid),
    '22222222-2222-4222-8222-222222222222'
  ),
  'test_access_denied',
  'a different student cannot start the closed paid test'
);

------------------------------------------------------------------
-- 19–20) Repeated close cannot extend; close at old expires_at
------------------------------------------------------------------
select test_helpers.as_user((select id from t_s3));
select public.start_attempt((select id from t_repeat), '33333333-3333-4333-8333-333333333333'::uuid)
  as payload into temp t_start_repeat;
grant select on t_start_repeat to authenticated;

select test_helpers.as_runner();
update public.test_attempts
set expires_at = now()
where id = ((select payload from t_start_repeat) ->> 'attempt_id')::uuid;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_repeat));

select test_helpers.as_runner();
select expires_at as exp into temp t_repeat_exp
from public.test_attempts
where id = ((select payload from t_start_repeat) ->> 'attempt_id')::uuid;
grant select on t_repeat_exp to authenticated;

select ok(
  (select ta.expires_at <= t.closes_at
   from public.test_attempts ta
   join public.tests t on t.id = ta.test_id
   where ta.id = ((select payload from t_start_repeat) ->> 'attempt_id')::uuid),
  'close exactly at old expires_at never extends the deadline'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select throws_ok(
  format('select public.close_test_now(%L)', (select id from t_repeat)),
  'test is not published',
  'repeated close-now is rejected once the test is closed'
);

select test_helpers.as_runner();
select is(
  (select expires_at from public.test_attempts
   where id = ((select payload from t_start_repeat) ->> 'attempt_id')::uuid),
  (select exp from t_repeat_exp),
  'repeated close-now cannot extend expires_at'
);

select * from finish();
rollback;
