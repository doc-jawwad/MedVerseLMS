-- Reattempts (tests.max_attempts): docs/test-rules.md "Attempt limit and reattempts".
-- Transaction-scoped; nothing persists.
begin;
select plan(58);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Reattempt Admin') as id into temp t_admin;
select test_helpers.make_student((select year_id from curriculum), 'Reattempt A') as id into temp t_a;
select test_helpers.make_student((select year_id from curriculum), 'Reattempt B') as id into temp t_b;
-- Enrolled, but in a different class than the test audience.
select test_helpers.make_student((select id from public.years where year_number = 2), 'Reattempt C') as id
  into temp t_c;
grant select on curriculum, t_admin, t_a, t_b, t_c to authenticated;

create function pg_temp.mk_test(p_max int, p_review text)
returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  perform test_helpers.as_runner();
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark,
    min_questions, max_attempts, show_review
  ) values (
    'PGTAP reattempt', (select year_id from curriculum), 'draft',
    now() - interval '1 minute', now() + interval '2 hours', 60, 0, 1, p_max, p_review
  ) returning id into v_id;
  insert into public.test_questions (test_id, question_id, position)
  select v_id, test_helpers.make_question((select topic_id from curriculum), 'A'), gs
  from generate_series(1, 3) gs;
  insert into public.test_audiences (test_id, year_id)
  values (v_id, (select year_id from curriculum));
  perform test_helpers.as_user((select id from t_admin), gen_random_uuid());
  perform public.publish_test(v_id);
  perform test_helpers.as_runner();
  return v_id;
end $f$;

-- Answer the first p_correct questions correctly ('A'), the rest wrongly, then submit.
create function pg_temp.finish(p_payload jsonb, p_device uuid, p_correct int)
returns void language plpgsql as $f$
declare r record;
begin
  for r in
    select (q ->> 'question_version_id')::uuid as qv, ord
    from jsonb_array_elements(p_payload -> 'questions') with ordinality t(q, ord)
  loop
    perform public.save_answer(
      (p_payload ->> 'attempt_id')::uuid, r.qv,
      (case when r.ord <= p_correct then 'A' else 'B' end)::char,
      false, 1, p_device
    );
  end loop;
  perform public.submit_attempt((p_payload ->> 'attempt_id')::uuid, p_device);
end $f$;

create function pg_temp.sit(p_test uuid, p_student uuid, p_device uuid, p_no int, p_correct int)
returns uuid language plpgsql as $f$
declare v_payload jsonb;
begin
  perform test_helpers.as_user(p_student);
  v_payload := public.start_attempt(p_test, p_device, p_no);
  perform pg_temp.finish(v_payload, p_device, p_correct);
  perform test_helpers.as_runner();
  return (v_payload ->> 'attempt_id')::uuid;
end $f$;

select pg_temp.mk_test(1, 'after_submit') as id into temp t_single;
select pg_temp.mk_test(3, 'after_submit') as id into temp t_multi;
select pg_temp.mk_test(2, 'after_submit') as id into temp t_paid;
grant select on t_single, t_multi, t_paid to authenticated, anon;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.set_resource_entitlement('test', (select id from t_paid), 'any_subscription');
select test_helpers.as_runner();

------------------------------------------------------------------
-- 1. Single-attempt backward compatibility (max_attempts default 1)
------------------------------------------------------------------
select is(
  (select max_attempts from public.tests where id = (select id from t_single)),
  1, 'single-attempt test has max_attempts = 1'
);
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'tests' and column_name = 'max_attempts'),
  '1', 'max_attempts defaults to 1'
);
select pg_temp.sit((select id from t_single), (select id from t_a),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid, null, 2) as aid into temp t_single_a;
grant select on t_single_a to authenticated;
select test_helpers.as_user((select id from t_a));
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_single), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'already_submitted', 'single-attempt: second start raises already_submitted'
);
select throws_ok(
  format('select public.start_attempt(%L, %L, 2)', (select id from t_single), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'already_submitted', 'single-attempt: explicit attempt number is ignored, still already_submitted'
);
select is(
  (select public.get_attempt_review((select aid from t_single_a)) ->> 'allowed'),
  'true', 'single-attempt after_submit review is open immediately (unchanged)'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.test_attempts where test_id = (select id from t_single)),
  1, 'single-attempt: exactly one attempt row'
);

------------------------------------------------------------------
-- 2. Multiple attempts, numbering and limits (max_attempts = 3)
------------------------------------------------------------------
select pg_temp.sit((select id from t_multi), (select id from t_a),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid, null, 1) as aid into temp t_m1;
grant select on t_m1 to authenticated;
-- Real starts are separate transactions with distinct started_at; back-date #1
-- so ordering by start time is meaningful inside this single test transaction.
update public.test_attempts set started_at = started_at - interval '1 hour'
  where id = (select aid from t_m1);

select test_helpers.as_user((select id from t_a));
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'already_submitted', 'multi: legacy start without an attempt number after a submit raises already_submitted'
);
select throws_ok(
  format('select public.start_attempt(%L, %L, 1)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'attempt_no_mismatch', 'multi: re-requesting attempt #1 is a stale/duplicate request'
);
select throws_ok(
  format('select public.start_attempt(%L, %L, 3)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'attempt_no_mismatch', 'multi: skipping ahead to attempt #3 is rejected'
);

-- Review hold while reattempts remain
select is(
  (select public.get_attempt_review((select aid from t_m1)) ->> 'reason'),
  'available_after_attempts', 'review held while attempts remain'
);
select ok(
  not ((select public.get_attempt_review((select aid from t_m1))) ? 'items'),
  'held review payload carries no items (no answer keys)'
);

-- Reattempt #2
select public.start_attempt((select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 2) as payload
  into temp t_p2;
grant select on t_p2 to authenticated;
select is((select payload ->> 'attempt_no' from t_p2), '2', 'reattempt reports attempt_no 2');
select isnt(
  (select payload ->> 'attempt_id' from t_p2), (select aid::text from t_m1),
  'reattempt is a new row with its own id'
);
select is(
  (select public.start_attempt((select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 2) ->> 'attempt_id'),
  (select payload ->> 'attempt_id' from t_p2),
  'duplicate retake start (same number) resumes the same attempt'
);
select is(
  (select public.start_attempt((select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid) ->> 'attempt_id'),
  (select payload ->> 'attempt_id' from t_p2),
  'start without a number while in progress resumes the same attempt'
);
select throws_ok(
  format('select public.start_attempt(%L, %L, 2)', (select id from t_multi), '99999999-0000-4000-8000-000000000009'),
  'attempt_locked_other_device', 'live attempt stays locked to its device'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a)),
  2, 'duplicate/retry starts created no extra rows'
);
select throws_ok(
  format($q$insert into public.test_attempts (test_id, student_id, expires_at, device_id, question_order)
    select test_id, student_id, expires_at, device_id, question_order from public.test_attempts where id = %L$q$,
    (select payload ->> 'attempt_id' from t_p2)),
  '23505', null, 'DB refuses a second in_progress attempt for the same student/test'
);

select test_helpers.as_user((select id from t_a));
select pg_temp.finish((select payload from t_p2), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 3);
select test_helpers.as_runner();

select is(
  (select score::int from public.test_attempts where id = (select aid from t_m1)),
  1, 'attempt #1 score preserved after a later attempt'
);

select pg_temp.sit((select id from t_multi), (select id from t_a),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 3, 2) as aid into temp t_m3;
grant select on t_m3 to authenticated;

select test_helpers.as_user((select id from t_a));
select throws_ok(
  format('select public.start_attempt(%L, %L, 4)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'attempt_limit_reached', 'attempts exhausted raises attempt_limit_reached'
);
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'already_submitted', 'exhausted + no attempt number keeps already_submitted'
);
select is(
  (select jsonb_array_length(public.get_attempt_review((select aid from t_m1)) -> 'items')),
  3, 'review opens once attempts are exhausted'
);
select test_helpers.as_runner();

select is(
  (select array_agg(score::int order by score) from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a)),
  array[1, 2, 3], 'all three attempts and scores preserved'
);
select is(
  (select count(distinct id)::int from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a)),
  3, 'each attempt has its own id'
);

------------------------------------------------------------------
-- 3. Ranking: best submitted attempt per student, one row per student
------------------------------------------------------------------
select pg_temp.sit((select id from t_multi), (select id from t_b),
  'bbbbbbbb-0000-4000-8000-000000000001'::uuid, null, 2) as aid into temp t_mb;
grant select on t_mb to authenticated;
select public.rank_dirty_tests();

select is(
  (select id from public.ranked_test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a)),
  (select id from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a) and score = 3),
  'student A ranked attempt is the best (3/3) attempt'
);
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a) and rank is not null),
  1, 'only the ranked attempt carries a rank'
);
select is(
  (select rank from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a) and score = 3),
  1, 'best attempt ranks #1'
);
select is(
  (select rank from public.test_attempts where id = (select aid from t_mb)),
  2, 'other student ranks #2 (n counts students, not attempts)'
);
select is(
  (select percentile from public.test_attempts where id = (select aid from t_mb)),
  0.00::numeric, 'percentile uses n = 2 students'
);

select test_helpers.as_user((select id from t_a));
select is(
  (select (public.student_test_summary() ->> 'tests_taken')::int),
  2, 'analytics: tests_taken counts tests (2), not attempts (4)'
);
select is(
  (select count(*)::int from public.test_leaderboard((select id from t_multi))),
  2, 'leaderboard has one row per student'
);
select is(
  (select public.get_own_test_result((select id from t_multi)) -> 'attempt' ->> 'id')::uuid,
  (select id from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a) and score = 3),
  'own result shows the ranked (best) attempt'
);
select is(
  (select jsonb_array_length(public.get_own_test_result((select id from t_multi)) -> 'attempts')),
  3, 'own result lists every one of the caller''s attempts'
);
select is(
  (select count(*)::int from jsonb_array_elements(
    public.get_own_test_result((select id from t_multi)) -> 'attempts') h
   where (h ->> 'is_ranked')::boolean),
  1, 'exactly one attempt is flagged as the ranked one'
);
select ok(
  position('correct_key' in (public.get_own_test_result((select id from t_multi)))::text) = 0,
  'own result never carries answer keys'
);
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select is(
  (select public.test_summary((select id from t_multi)) ->> 'attempted'),
  '2', 'admin summary: attempted counts distinct students'
);
select is(
  (select public.test_summary((select id from t_multi)) ->> 'completed'),
  '2', 'admin summary: completed counts distinct students'
);

------------------------------------------------------------------
-- 4. Invalidation: history kept, count freed, ranking recomputed
------------------------------------------------------------------
select public.invalidate_attempt(
  (select id from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a) and score = 3),
  'device failure'
);
select test_helpers.as_runner();
select ok(
  exists (select 1 from public.rank_dirty_queue where test_id = (select id from t_multi)),
  'invalidating a submitted attempt marks the test rank-dirty'
);
select public.rank_dirty_tests();
select is(
  (select score::int from public.test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a) and state = 'invalidated'),
  3, 'invalidated attempt row and score preserved'
);
select is(
  (select id from public.ranked_test_attempts
    where test_id = (select id from t_multi) and student_id = (select id from t_a)),
  (select aid from t_m3), 'ranked attempt falls back to the next best valid attempt'
);
select is(
  (select count(*)::int from public.test_attempts
    where test_id = (select id from t_multi) and state = 'submitted' and rank is not null),
  2, 'still exactly one ranked submitted row per student after invalidation'
);

select test_helpers.as_user((select id from t_a));
select lives_ok(
  format('select public.start_attempt(%L, %L, 3)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'invalidated attempt no longer counts: a fresh attempt is allowed'
);
select is(
  (select public.get_attempt_review((select aid from t_m3)) ->> 'reason'),
  'available_after_attempts', 'review hold re-applies once an attempt is live again'
);

------------------------------------------------------------------
-- 5. Closed test: no new attempts; resume ok; hold lifts
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.close_test_now((select id from t_multi));
select test_helpers.as_user((select id from t_b));
select throws_ok(
  format('select public.start_attempt(%L, %L, 2)', (select id from t_multi), 'bbbbbbbb-0000-4000-8000-000000000001'),
  'test_window_closed', 'retake after the test closes is rejected'
);
select test_helpers.as_user((select id from t_a));
select lives_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_multi), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'live attempt can still resume after close'
);
select is(
  (select public.get_attempt_review((select aid from t_m3)) ->> 'allowed'),
  'true', 'review hold lifts when the test closes'
);

------------------------------------------------------------------
-- 6. Authorization / RLS
------------------------------------------------------------------
select test_helpers.as_user((select id from t_b));
select is(
  (select count(*)::int from public.test_attempts where student_id = (select id from t_a)),
  0, 'a student cannot read another student''s attempts (RLS)'
);
select throws_ok(
  format('select public.get_attempt_review(%L)', (select aid from t_m3)),
  'attempt_not_found', 'a student cannot review another student''s attempt'
);
select throws_ok(
  'select count(*) from public.ranked_test_attempts',
  '42501', null, 'ranked_test_attempts is not readable by students'
);
select test_helpers.as_user((select id from t_c));
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_single), 'cccccccc-0000-4000-8000-000000000001'),
  'test_access_denied', 'wrong-class student cannot start'
);
select test_helpers.as_user((select id from t_a));
select lives_ok(
  format('update public.tests set max_attempts = 99 where id = %L', (select id from t_single)),
  'student update of max_attempts is a no-op under RLS'
);
select test_helpers.as_anon();
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_single), 'dddddddd-0000-4000-8000-000000000001'),
  '42501', null, 'anon cannot call start_attempt'
);
select test_helpers.as_runner();
select is(
  (select max_attempts from public.tests where id = (select id from t_single)),
  1, 'max_attempts unchanged by student update'
);

------------------------------------------------------------------
-- 7. Config validation, freeze, reuse
------------------------------------------------------------------
select throws_ok(
  $q$insert into public.tests (title, year_id, max_attempts)
     values ('bad', (select year_id from curriculum), 0)$q$,
  '23514', null, 'max_attempts must be >= 1'
);
select throws_ok(
  format('update public.tests set max_attempts = 5 where id = %L', (select id from t_multi)),
  'P0001', 'published test config is frozen (docs/test-rules.md)',
  'max_attempts is frozen after publish'
);
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.reuse_test_as_draft((select id from t_multi)) as id into temp t_reuse;
grant select on t_reuse to authenticated;
select test_helpers.as_runner();
select is(
  (select max_attempts from public.tests where id = (select id from t_reuse)),
  3, 'reuse_test_as_draft copies max_attempts'
);
select test_helpers.as_runner();

------------------------------------------------------------------
-- 8. Paid access unchanged for reattempts
------------------------------------------------------------------
insert into public.test_attempts
  (test_id, student_id, state, expires_at, submitted_at, submit_source, device_id,
   question_order, score, max_score, percentage)
select (select id from t_paid), (select id from t_a), 'submitted', now(), now(), 'student',
  gen_random_uuid(), question_order, 1, 3, 33.33
from public.test_attempts where id = (select aid from t_m1);

select test_helpers.as_user((select id from t_a));
select throws_ok(
  format('select public.start_attempt(%L, %L, 2)', (select id from t_paid), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'test_access_denied', 'paid retake without live entitlement is denied'
);
select throws_ok(
  format('select public.start_attempt(%L, %L)', (select id from t_paid), 'aaaaaaaa-0000-4000-8000-000000000001'),
  'already_submitted', 'paid: legacy start after a submit keeps already_submitted'
);
select test_helpers.as_runner();

select * from finish();
rollback;
