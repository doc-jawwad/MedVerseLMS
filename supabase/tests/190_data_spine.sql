-- Data Spine: class lock, admin year assignments, practice progress,
-- tree/search, leaderboard projection, profile avatar.
begin;
select plan(36);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Spine Free') as id
  into temp t_free;
select test_helpers.make_student((select year_id from curriculum), 'Spine Pending') as id
  into temp t_pending;
select test_helpers.make_student((select year_id from curriculum), 'Spine Paid') as id
  into temp t_paid;
select test_helpers.make_student((select year_id from curriculum), 'Spine Other') as id
  into temp t_other;
select test_helpers.make_admin('Spine Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Spine Limited',
  array['manage_admins', 'view_students', 'view_analytics']
) as id into temp t_limited;
select id into temp t_year2 from public.years where year_number = 2;
select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q;
select test_helpers.make_published_test(
  (select topic_id from curriculum),
  (select year_id from curriculum),
  2
) as id into temp t_test;

-- Bind sessions for account_allows_lms / is_active_session paths that need them
update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_free);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
where id = (select id from t_pending);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'
where id = (select id from t_other);

-- Free subject entitlement for practice
update public.subjects
set entitlement = 'free'
where id = (select subject_id from curriculum);

grant select on curriculum, t_free, t_pending, t_paid, t_other, t_main, t_limited,
  t_year2, t_plan, t_q, t_test
  to anon, authenticated;

------------------------------------------------------------------
-- Class lock: free / pending / paid
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);

select is(public.get_class_lock_state()->>'lock', 'free', '1 free lock');
select ok((public.get_class_lock_state()->>'can_self_change')::boolean, '2 free can self-change');

select lives_ok(
  format('select public.self_change_class(%L::uuid)', (select id from t_year2)),
  '3 self_change_class ok'
);

select is(
  (select year_id from public.enrollments
   where student_id = (select id from t_free) and status = 'active'),
  (select id from t_year2),
  '4 enrollment moved to year 2'
);

select throws_ok(
  format('select public.create_year_change_request(%L::uuid)', (select year_id from curriculum)),
  'use_self_change_class',
  '5 free cannot use year_change_request'
);

-- Pending application lock (runner inserts with RPC GUC)
select test_helpers.as_runner();
select set_config('medverse.subscription_application_rpc', '1', true);
insert into public.subscription_applications (
  student_id, plan_id, amount, currency, screenshot_object_key, status, year_id
) values (
  (select id from t_pending),
  (select id from t_plan),
  1000,
  'PKR',
  'payment-proofs/' || (select id from t_pending)::text || '/shot',
  'pending',
  (select year_id from curriculum)
);
select set_config('medverse.subscription_application_rpc', '', true);

select test_helpers.as_user(
  (select id from t_pending),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid
);
select is(public.get_class_lock_state()->>'lock', 'pending_application', '6 pending lock');
select throws_ok(
  format('select public.self_change_class(%L::uuid)', (select id from t_year2)),
  'class_locked',
  '7 pending cannot self_change'
);

-- Live subscription lock
select test_helpers.as_runner();
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_paid),
  (select id from t_plan),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  (select year_id from curriculum),
  0,
  'all_entitled'
);

select test_helpers.as_user(
  (select id from t_paid),
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
);
select is(public.get_class_lock_state()->>'lock', 'active_subscription', '8 paid lock');
select throws_ok(
  format('select public.self_change_class(%L::uuid)', (select id from t_year2)),
  'class_locked',
  '9 paid cannot self_change'
);

------------------------------------------------------------------
-- Admin year assignments
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.as_user((select id from t_main));

select lives_ok(
  format(
    'select public.set_admin_year_assignments(%L::uuid, array[%L::uuid])',
    (select id from t_limited),
    (select year_id from curriculum)
  ),
  '10 set_admin_year_assignments'
);

select is(
  (select count(*)::int from public.list_admin_year_assignments((select id from t_limited))),
  1,
  '11 list assignments'
);

select ok(
  public.admin_can_access_year((select year_id from curriculum)),
  '12 main admin can access year'
);

select test_helpers.as_runner();
select test_helpers.as_user((select id from t_limited));
select ok(
  public.admin_can_access_year((select year_id from curriculum)),
  '13 limited can access assigned year'
);
select ok(
  not public.admin_can_access_year((select id from t_year2)),
  '14 limited cannot access other year'
);

select test_helpers.as_runner();
select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);
select throws_ok(
  'select * from public.list_admin_year_assignments()',
  'admin only',
  '15 student blocked from list_admin_year_assignments'
);

------------------------------------------------------------------
-- Practice progress
------------------------------------------------------------------
select test_helpers.as_runner();
-- Move free student back to curriculum year for practice subject visibility
select set_config('medverse.class_change_rpc', '1', true);
update public.enrollments
set status = 'expired'
where student_id = (select id from t_free) and status = 'active';
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_free), (select year_id from curriculum), 'active');
select set_config('medverse.class_change_rpc', '', true);

select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);

select lives_ok(
  format(
    'select public.set_practice_item_state(''question'', %L::uuid, ''done'')',
    (select id from t_q)
  ),
  '16 set done'
);
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q)
  ),
  '17 set marked'
);
select ok(
  (public.get_practice_progress((select subject_id from curriculum))->>'done')::int >= 1,
  '18 progress done count'
);
select lives_ok(
  format(
    'select public.reset_practice_done_to_remaining(%L::uuid)',
    (select subject_id from curriculum)
  ),
  '19 reset done'
);
select is(
  (select state from public.practice_progress
   where student_id = (select id from t_free) and item_id = (select id from t_q)),
  'remaining',
  '20 reset → remaining'
);
select is(
  (select marked from public.practice_progress
   where student_id = (select id from t_free) and item_id = (select id from t_q)),
  true,
  '21 marked preserved'
);

select test_helpers.as_runner();
select test_helpers.as_user(
  (select id from t_other),
  'dddddddd-dddd-dddd-dddd-ddddddddddd1'::uuid
);
select is(
  (select count(*)::int from public.practice_progress
   where student_id = (select id from t_free)),
  0,
  '22 no cross-student practice_progress SELECT'
);

------------------------------------------------------------------
-- Tree / search
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.as_user(
  (select id from t_free),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid
);

select ok(
  (public.get_academic_tree('resources')->>'year_id') is not null,
  '23 tree year_id'
);
select ok(
  jsonb_typeof(public.get_academic_tree('resources')->'subjects') = 'array',
  '24 tree subjects array'
);
select ok(
  position('correct_key' in public.get_academic_tree('resources')::text) = 0,
  '25 no correct_key in tree'
);
select ok(
  position('drive_url' in public.get_academic_tree('resources')::text) = 0,
  '26 no drive_url in tree'
);
select ok(
  jsonb_array_length(
    public.search_academic_tree(
      (select name from public.subjects where id = (select subject_id from curriculum)),
      10
    )
  ) >= 1,
  '27 search finds subject name'
);

------------------------------------------------------------------
-- Leaderboard projection (submitted attempt owner can view)
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.as_user(
  (select id from t_paid),
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
);
-- Ensure formal test is startable under live subscription
select test_helpers.as_runner();
update public.tests
set entitlement = 'free'
where id = (select id from t_test);

select test_helpers.as_user(
  (select id from t_paid),
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
);
select public.start_attempt(
  (select id from t_test),
  '11111111-1111-4111-8111-111111111111'::uuid
) as payload into temp t_attempt;
grant select on t_attempt to authenticated;

select public.submit_attempt(
  ((select payload from t_attempt) ->> 'attempt_id')::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid
);

-- Ranking is coalesced via rank_dirty_queue; drain so projection has ranks.
select test_helpers.as_runner();
select public.rank_dirty_tests();

select test_helpers.as_user(
  (select id from t_paid),
  'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid
);

select ok(
  jsonb_array_length(public.test_leaderboard_projection((select id from t_test), 3)) >= 1,
  '28 projection returns rows'
);
select ok(
  (public.test_leaderboard_projection((select id from t_test), 3)->0) ? 'college_name',
  '29 has college_name'
);
select ok(
  (public.test_leaderboard_projection((select id from t_test), 3)->0) ? 'avatar_object_key',
  '30 has avatar_object_key'
);
select ok(
  not ((public.test_leaderboard_projection((select id from t_test), 3)->0) ? 'email'),
  '31 no email'
);

------------------------------------------------------------------
-- Profile + avatar
------------------------------------------------------------------
select lives_ok(
  $$select public.update_own_profile('Spine Paid Updated', 'KEMU')$$,
  '32 update_own_profile'
);
select is(
  (select college_name from public.profiles where id = (select id from t_paid)),
  'KEMU',
  '33 college persisted'
);
select lives_ok($$select public.allocate_avatar_object_key()$$, '34 allocate avatar');
select ok(
  (select avatar_object_key from public.profiles where id = (select id from t_paid))
    like 'study-content/avatars/%',
  '35 avatar key prefix'
);

select test_helpers.as_runner();
select test_helpers.as_user(
  (select id from t_other),
  'dddddddd-dddd-dddd-dddd-ddddddddddd1'::uuid
);
select throws_ok(
  format('select public.authorize_avatar_object(%L::uuid)', (select id from t_paid)),
  'avatar_forbidden',
  '36 peer avatar forbidden'
);

select * from finish();
rollback;
