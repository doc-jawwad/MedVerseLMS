-- Ranking coalescing + ensure_profile (VPS Auth/DB split).
-- Transaction-scoped fixtures, rolled back.

begin;
select plan(22);

select test_helpers.as_runner();
-- Shared staging can contain dirty tests from real staging fixtures. Drain
-- them inside this transaction so the assertion below counts only this
-- suite's dirty test; ROLLBACK restores all pre-existing staging state.
select public.rank_dirty_tests();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Existing Student') as id
  into temp t_existing;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_test;
grant select on curriculum, t_existing, t_test to anon, authenticated;

------------------------------------------------------------------
-- ensure_profile: JWT subject is the profile UUID; no local auth.users row
------------------------------------------------------------------
select gen_random_uuid() as id into temp t_ensured;
grant select on t_ensured to anon, authenticated;

select test_helpers.as_anon();
select throws_ok(
  'select public.ensure_profile()',
  'permission denied for function ensure_profile',
  'anon cannot call ensure_profile'
);

select test_helpers.as_user(
  (select id from t_ensured),
  null,
  (select id from t_ensured) || '@ensure.invalid',
  jsonb_build_object(
    'full_name', 'Ensured Student',
    'year_id', (select year_id from curriculum)
  )
);
select lives_ok(
  'select public.ensure_profile()',
  'authenticated caller can ensure their own profile'
);

select test_helpers.as_runner();
select is(
  (select id from public.profiles where id = (select id from t_ensured)),
  (select id from t_ensured),
  'ensure_profile uses the authenticated JWT subject as profiles.id'
);
select is(
  (select email from public.profiles where id = (select id from t_ensured)),
  (select id from t_ensured) || '@ensure.invalid',
  'ensure_profile copies email from JWT claims'
);
select is(
  (select full_name from public.profiles where id = (select id from t_ensured)),
  'Ensured Student',
  'ensure_profile copies full_name from JWT user_metadata'
);
select is(
  (select role from public.profiles where id = (select id from t_ensured)),
  'student',
  'ensure_profile inserts the default student role'
);
select is(
  (select count(*)::int from auth.users where id = (select id from t_ensured)),
  0,
  'ensure_profile does not require a local auth.users row (FK dropped)'
);
select is(
  (select count(*)::int from public.enrollments
   where student_id = (select id from t_ensured) and status = 'active'
     and year_id = (select year_id from curriculum)),
  1,
  'ensure_profile creates an active class enrollment from JWT year_id'
);

-- Repeat: still one profile, still one live enrollment, role unchanged.
select test_helpers.as_user(
  (select id from t_ensured),
  null,
  (select id from t_ensured) || '@ensure.invalid',
  jsonb_build_object(
    'full_name', 'Ensured Student',
    'year_id', (select year_id from curriculum)
  )
);
select lives_ok(
  'select public.ensure_profile()',
  'ensure_profile is safe to call repeatedly'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.profiles where id = (select id from t_ensured)),
  1,
  'repeat ensure_profile does not duplicate the profile'
);
select is(
  (select count(*)::int from public.enrollments where student_id = (select id from t_ensured)),
  1,
  'repeat ensure_profile does not duplicate enrollment'
);

-- Existing handle_new_user student already has an active enrollment.
select test_helpers.as_user((select id from t_existing));
select lives_ok('select public.ensure_profile()', 'ensure_profile is a no-op insert on an existing profile');
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.enrollments
   where student_id = (select id from t_existing) and status = 'active'),
  1,
  'ensure_profile does not add a second class enrollment when an active enrollment already exists'
);

------------------------------------------------------------------
-- RLS: a student cannot read another student's newly ensured profile
------------------------------------------------------------------
select test_helpers.as_user((select id from t_existing));
select is(
  (select count(*)::int from public.profiles where id = (select id from t_ensured)),
  0,
  'a student cannot SELECT another student''s ensure_profile-created row'
);

select test_helpers.as_user((select id from t_ensured));
select throws_ok(
  'select public.rank_dirty_tests()',
  'permission denied for function rank_dirty_tests',
  'authenticated student cannot call rank_dirty_tests'
);

------------------------------------------------------------------
-- Exam path after FK drop: score now, rank later; submit still idempotent
------------------------------------------------------------------
-- Use t_existing (active class enrollment + audience year).
select test_helpers.as_user((select id from t_existing));
select public.start_attempt((select id from t_test), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) as payload
  into temp t_start;
grant select on t_start to authenticated;

select public.submit_attempt(
  ((select payload from t_start) ->> 'attempt_id')::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
) as result into temp t_submit1;
grant select on t_submit1 to authenticated;

select is(
  ((select result from t_submit1) ->> 'score')::numeric,
  0::numeric,
  'submit_attempt still scores correctly with coalesced ranking'
);
select is(
  ((select result from t_submit1) ->> 'state'),
  'submitted',
  'submit_attempt still transitions in_progress -> submitted'
);

select test_helpers.as_runner();
select is(
  (select rank from public.test_attempts
   where id = ((select payload from t_start) ->> 'attempt_id')::uuid),
  null,
  'submit_attempt does not write rank synchronously'
);

select test_helpers.as_user((select id from t_existing));
select public.submit_attempt(
  ((select payload from t_start) ->> 'attempt_id')::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
) as result into temp t_submit2;
select is(
  (select result from t_submit2),
  (select result from t_submit1),
  'duplicate submit_attempt remains an idempotent success'
);

select test_helpers.as_runner();
select is(
  (select public.rank_dirty_tests()),
  1,
  'rank_dirty_tests ranks the dirty test once'
);
select is(
  (select rank from public.test_attempts
   where id = ((select payload from t_start) ->> 'attempt_id')::uuid),
  1,
  'coalesced rank_test still assigns RANK 1; n<=1 percentile stays null (checked next)'
);
select is(
  (select percentile from public.test_attempts
   where id = ((select payload from t_start) ->> 'attempt_id')::uuid),
  null,
  'n<=1 percentile remains null after coalesced ranking'
);

select * from finish();
rollback;
