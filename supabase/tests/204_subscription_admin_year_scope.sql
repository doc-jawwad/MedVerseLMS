-- Admin year/class scope for subscriptions + activate plan-year coherence.
-- Complements 120/130/141/202/203; does not re-test class-switch remap.

begin;
select plan(18);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;

select test_helpers.make_student((select id from t_y1), 'Scope Y1 Student') as id
  into temp t_student_y1;
select test_helpers.make_student((select id from t_y2), 'Scope Y2 Student') as id
  into temp t_student_y2;
select test_helpers.make_admin('Scope Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Scope Y1 Mgr',
  array['manage_subscriptions', 'review_subscription_applications']
) as id into temp t_y1_mgr;
select test_helpers.make_limited_admin(
  'Scope Y2 Mgr',
  array['manage_subscriptions', 'review_subscription_applications']
) as id into temp t_y2_mgr;
select test_helpers.make_limited_admin(
  'Scope Pay',
  array['manage_payment_settings']
) as id into temp t_pay;

grant select on curriculum, t_y1, t_y2, t_student_y1, t_student_y2, t_main,
  t_y1_mgr, t_y2_mgr, t_pay
  to anon, authenticated;

select test_helpers.as_user((select id from t_main));
select public.set_admin_year_assignments(
  (select id from t_y1_mgr),
  array[(select id from t_y1)]
);
select public.set_admin_year_assignments(
  (select id from t_y2_mgr),
  array[(select id from t_y2)]
);

select test_helpers.as_user((select id from t_pay));
select public.upsert_payment_settings(
  p_bank_name => 'PGTAP Scope Bank',
  p_account_number => '22222',
  p_is_active => true
);

-- Plans for each year (main admin).
select test_helpers.as_user((select id from t_main));
select public.create_subscription_plan(
  p_name => 'PGTAP Scope Y1',
  p_year_id => (select id from t_y1),
  p_price => 5000,
  p_duration_days => 365
) as id into temp t_plan_y1;
select public.create_subscription_plan(
  p_name => 'PGTAP Scope Y2',
  p_year_id => (select id from t_y2),
  p_price => 6000,
  p_duration_days => 365
) as id into temp t_plan_y2;
select public.create_subscription_plan(
  p_name => 'PGTAP Scope Y1 Comp',
  p_year_id => (select id from t_y1),
  p_price => 0,
  p_is_complimentary => true,
  p_duration_days => 365
) as id into temp t_comp_y1;

grant select on t_plan_y1, t_plan_y2, t_comp_y1 to anon, authenticated;

------------------------------------------------------------------
-- 1-2. Limited admin cannot create plan outside assigned year
------------------------------------------------------------------
select test_helpers.as_user((select id from t_y1_mgr));
select throws_ok(
  format(
    $$select public.create_subscription_plan(
      p_name => 'Nope',
      p_year_id => %L::uuid,
      p_price => 1,
      p_duration_days => 30
    )$$,
    (select id from t_y2)
  ),
  'P0001',
  'year_scope_denied',
  '1 y1 manager cannot create y2 plan'
);

select lives_ok(
  format(
    $$select public.create_subscription_plan(
      p_name => 'PGTAP Scope Y1 Extra',
      p_year_id => %L::uuid,
      p_price => 100,
      p_duration_days => 30
    )$$,
    (select id from t_y1)
  ),
  '2 y1 manager can create y1 plan'
);

------------------------------------------------------------------
-- 3-4. activate: cross-year plan rejected; complimentary same-year ok
------------------------------------------------------------------
select throws_ok(
  format(
    $$select public.activate_subscription(
      %L::uuid, %L::uuid, null, null, null, null, null, %L::uuid
    )$$,
    (select id from t_student_y1),
    (select id from t_plan_y2),
    (select id from t_y1)
  ),
  'P0001',
  'plan_year_mismatch',
  '3 activate rejects cross-year plan'
);

select lives_ok(
  format(
    $$select public.activate_subscription(
      %L::uuid, %L::uuid,
      now() - interval '30 days',
      now() + interval '60 days',
      null, null, null, %L::uuid
    )$$,
    (select id from t_student_y1),
    (select id from t_comp_y1),
    (select id from t_y1)
  ),
  '4 complimentary activate same-year ok'
);

select id as id into temp t_sub_y1
  from public.subscriptions
  where student_id = (select id from t_student_y1)
    and status = 'active'
  limit 1;
grant select on t_sub_y1 to anon, authenticated;

------------------------------------------------------------------
-- 5-6. SELECT RLS: y1 manager sees y1 sub, not y2 sub
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
select public.activate_subscription(
  (select id from t_student_y2),
  (select id from t_plan_y2),
  null, null, null, null, null,
  (select id from t_y2)
) as id into temp t_sub_y2;
grant select on t_sub_y2 to anon, authenticated;

select test_helpers.as_user((select id from t_y1_mgr));
select is(
  (select count(*)::int from public.subscriptions where id = (select id from t_sub_y1)),
  1,
  '5 y1 manager can select y1 subscription'
);
select is(
  (select count(*)::int from public.subscriptions where id = (select id from t_sub_y2)),
  0,
  '6 y1 manager cannot select y2 subscription'
);

------------------------------------------------------------------
-- 7-8. Mutations: y2 manager denied on y1 subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_y2_mgr));
select throws_ok(
  format(
    $$select public.extend_subscription(%L::uuid, 30)$$,
    (select id from t_sub_y1)
  ),
  'P0001',
  'year_scope_denied',
  '7 y2 manager cannot extend y1 subscription'
);
select throws_ok(
  format(
    $$select public.deactivate_subscription(%L::uuid)$$,
    (select id from t_sub_y1)
  ),
  'P0001',
  'year_scope_denied',
  '8 y2 manager cannot deactivate y1 subscription'
);

------------------------------------------------------------------
-- 9-12. Application review year scope + student plan binding
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
-- Expire y1 live so student can apply again if needed; use a fresh student.
select test_helpers.make_student((select id from t_y1), 'Scope Apply') as id
  into temp t_apply;
grant select on t_apply to anon, authenticated;

select test_helpers.as_user((select id from t_apply));
select public.allocate_payment_screenshot_object_key() as key into temp t_key;
grant select on t_key to anon, authenticated;

select lives_ok(
  format(
    $$select public.create_subscription_application(
      5000, %L, %L::uuid, 'PKR', %L::uuid
    )$$,
    (select key from t_key),
    (select id from t_plan_y1),
    (select id from t_y1)
  ),
  '9 valid application succeeds'
);

select id as id into temp t_app
  from public.subscription_applications
  where student_id = (select id from t_apply) and status = 'pending'
  limit 1;
grant select on t_app to anon, authenticated;

select is(
  (select amount from public.subscription_applications where id = (select id from t_app)),
  5000::numeric,
  '10 amount remains student-submitted (not plan.price overwrite)'
);

select test_helpers.as_user((select id from t_y2_mgr));
select throws_ok(
  format(
    $$select public.approve_subscription_application(%L::uuid)$$,
    (select id from t_app)
  ),
  'P0001',
  'year_scope_denied',
  '11 y2 manager cannot approve y1 application'
);

select is(
  (select count(*)::int from public.subscription_applications where id = (select id from t_app)),
  0,
  '12 y2 manager cannot SELECT y1 application via RLS'
);

select test_helpers.as_user((select id from t_y1_mgr));
select lives_ok(
  format(
    $$select public.approve_subscription_application(%L::uuid)$$,
    (select id from t_app)
  ),
  '13 y1 manager can approve y1 application'
);

------------------------------------------------------------------
-- 14-15. Student isolation + inactive/tampered amount rejects
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student_y2));
select is(
  (select count(*)::int from public.subscriptions where student_id = (select id from t_student_y1)),
  0,
  '14 peer cannot read other student subscription'
);

select test_helpers.as_user((select id from t_apply));
select public.allocate_payment_screenshot_object_key() as key into temp t_key2;
grant select on t_key2 to anon, authenticated;
-- Student already has live sub from approval; pending create should fail differently.
-- Use student_y2 for amount/inactive checks.
select test_helpers.as_user((select id from t_student_y2));
-- Deactivate y2 live first via main so student can apply.
select test_helpers.as_user((select id from t_main));
select public.deactivate_subscription((select id from t_sub_y2));

select test_helpers.as_user((select id from t_student_y2));
select public.allocate_payment_screenshot_object_key() as key into temp t_key3;
grant select on t_key3 to anon, authenticated;

select throws_ok(
  format(
    $$select public.create_subscription_application(
      -10, %L, %L::uuid, 'PKR', %L::uuid
    )$$,
    (select key from t_key3),
    (select id from t_plan_y2),
    (select id from t_y2)
  ),
  'P0001',
  'invalid_amount',
  '15 tampered/negative amount rejected'
);

select public.allocate_payment_screenshot_object_key() as key into temp t_key4;
grant select on t_key4 to anon, authenticated;

select throws_ok(
  format(
    $$select public.create_subscription_application(
      100, %L, %L::uuid, 'PKR', %L::uuid
    )$$,
    (select key from t_key4),
    (select id from t_plan_y1),
    (select id from t_y2)
  ),
  'P0001',
  'plan_year_mismatch',
  '16 student cannot bind other-year plan to enrolled year'
);

------------------------------------------------------------------
-- 17-18. Expiry entitlement + restore path (smoke via helpers)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main));
-- starts_at was 30 days ago; ending yesterday is a valid window that is no longer live.
select public.set_subscription_end(
  (select id from t_sub_y1),
  now() - interval '1 day'
);

select test_helpers.as_user((select id from t_student_y1));
select is(
  public.has_live_subscription(),
  false,
  '17 expired subscription removes live entitlement'
);

select test_helpers.as_user((select id from t_main));
select public.expire_due_subscriptions((select id from t_student_y1));
select lives_ok(
  format(
    $$select public.activate_subscription(
      %L::uuid, %L::uuid,
      now() - interval '1 day',
      now() + interval '30 days',
      null, null, null, %L::uuid
    )$$,
    (select id from t_student_y1),
    (select id from t_comp_y1),
    (select id from t_y1)
  ),
  '18 reauthorization via complimentary activate restores access'
);

select * from finish();
rollback;
