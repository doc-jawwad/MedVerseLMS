-- Check 5 M1: blocked students cannot get_attempt_review via PostgREST/RPC.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'C5 Review Student') as id
  into temp t_student;
select test_helpers.make_admin('C5 Review Main') as id into temp t_main;
select test_helpers.make_limited_admin('C5 Review View', array['view_students']) as id
  into temp t_view;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_test;

update public.tests
  set show_review = 'after_submit'
  where id = (select id from t_test);

grant select on curriculum, t_student, t_main, t_view, t_test to anon, authenticated;

------------------------------------------------------------------
-- Sit and submit while active
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select public.register_session();
select public.start_attempt((select id from t_test), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid)
  as payload into temp t_start;
grant select on t_start to authenticated;

select
  ((select payload from t_start) ->> 'attempt_id')::uuid as aid,
  (value ->> 'question_version_id')::uuid as qv,
  ordinality
into temp t_q
from jsonb_array_elements((select payload from t_start) -> 'questions') with ordinality;
grant select on t_q to authenticated;

select public.save_answer(
  aid, qv, 'A', false, ordinality::bigint, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid
) from t_q;
select public.submit_attempt(
  (select aid from t_q limit 1), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid
);

select ok(
  (public.get_attempt_review((select aid from t_q limit 1)) ->> 'allowed')::boolean,
  'active student can get_attempt_review when show_review allows'
);
select ok(
  jsonb_array_length(public.get_attempt_review((select aid from t_q limit 1)) -> 'items') >= 1,
  'active student review returns items including answer keys'
);

------------------------------------------------------------------
-- Blocked statuses cannot obtain review content
------------------------------------------------------------------
select test_helpers.as_runner();
update public.profiles
set account_status = 'restricted'
where id = (select id from t_student);

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format(
    'select public.get_attempt_review(%L)',
    (select aid from t_q limit 1)
  ),
  'account_not_eligible',
  'restricted student cannot get_attempt_review'
);

select test_helpers.as_runner();
update public.profiles set account_status = 'suspended' where id = (select id from t_student);
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format('select public.get_attempt_review(%L)', (select aid from t_q limit 1)),
  'account_not_eligible',
  'suspended student cannot get_attempt_review'
);

select test_helpers.as_runner();
update public.profiles set account_status = 'deactivated' where id = (select id from t_student);
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format('select public.get_attempt_review(%L)', (select aid from t_q limit 1)),
  'account_not_eligible',
  'deactivated student cannot get_attempt_review'
);

select test_helpers.as_runner();
update public.profiles set account_status = 'revoked' where id = (select id from t_student);
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format('select public.get_attempt_review(%L)', (select aid from t_q limit 1)),
  'account_not_eligible',
  'revoked student cannot get_attempt_review'
);

------------------------------------------------------------------
-- Admin review and Layer-2 exam path remain intact
------------------------------------------------------------------
select test_helpers.as_user((select id from t_view), gen_random_uuid());
select ok(
  (public.get_attempt_review((select aid from t_q limit 1)) ->> 'allowed')::boolean,
  'view_students admin can still review a blocked student attempt'
);

select test_helpers.as_user((select id from t_main), gen_random_uuid());
select ok(
  (public.get_attempt_review((select aid from t_q limit 1)) ->> 'allowed')::boolean,
  'Main Admin can still review a blocked student attempt'
);

-- Layer 2: blocked account with live attempt may still save/submit (unchanged)
select test_helpers.as_runner();
update public.profiles set account_status = 'active' where id = (select id from t_student);
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 1
) as id into temp t_live;
grant select on t_live to authenticated;

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select public.register_session();
select public.start_attempt((select id from t_live), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001'::uuid)
  as payload into temp t_live_start;
grant select on t_live_start to authenticated;

select test_helpers.as_runner();
update public.profiles set account_status = 'restricted' where id = (select id from t_student);

select test_helpers.as_user((select id from t_student), gen_random_uuid());
-- Session may be superseded for portal; Layer 2 uses device/session on the attempt.
-- Re-bind JWT session_id to the attempt's session for owns_live / save path.
select test_helpers.as_runner();
select session_id::text as sid into temp t_sess
from public.test_attempts
where id = (((select payload from t_live_start) ->> 'attempt_id')::uuid);
grant select on t_sess to authenticated;

select test_helpers.as_user(
  (select id from t_student),
  (select sid::uuid from t_sess)
);
select lives_ok(
  format(
    'select public.save_answer(%L, %L, ''A'', false, 1, %L)',
    ((select payload from t_live_start) ->> 'attempt_id')::uuid,
    ((select payload from t_live_start) -> 'questions' -> 0 ->> 'question_version_id')::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0001'::uuid
  ),
  'restricted student can still save_answer on live leave_in_progress attempt'
);

select ok(
  (
    select prosecdef and proconfig::text like '%search_path=public%'
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'get_attempt_review'
  ),
  'get_attempt_review remains SECURITY DEFINER with search_path=public'
);

select * from finish();
rollback;
