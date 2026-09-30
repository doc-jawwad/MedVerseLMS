-- Class-scoped plan binding on create/update subscription applications.
-- Covers: valid plan/year, cross-year reject, inactive reject,
-- unenrolled year reject, pending update with cross-year plan reject.

begin;
select plan(9);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'PlanBind Student') as id
  into temp t_student;
select test_helpers.make_admin('PlanBind Admin') as id into temp t_admin;
select test_helpers.make_limited_admin(
  'PlanBind Pay',
  array['manage_payment_settings']
) as id into temp t_pay;
select test_helpers.make_limited_admin(
  'PlanBind Manager',
  array['manage_subscriptions']
) as id into temp t_manager;

select id as id into temp t_year2
  from public.years where year_number = 2 limit 1;

grant select on curriculum, t_student, t_admin, t_pay, t_manager, t_year2
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_admin_year_assignments(
  (select id from t_manager),
  array[(select year_id from curriculum), (select id from t_year2)]
);

-- Payment settings must be active for application RPCs that students use.
select test_helpers.as_user((select id from t_pay));
select public.upsert_payment_settings(
  p_bank_name => 'PGTAP PlanBind Bank',
  p_account_number => '11111',
  p_is_active => true
);

-- Year1 active plan + Year2 active plan + Year1 inactive plan.
select test_helpers.as_user((select id from t_manager));
select public.create_subscription_plan(
  p_name => 'PGTAP PlanBind Y1',
  p_year_id => (select year_id from curriculum),
  p_price => 5000,
  p_duration_days => 365
) as id into temp t_plan_y1;

select public.create_subscription_plan(
  p_name => 'PGTAP PlanBind Y2',
  p_year_id => (select id from t_year2),
  p_price => 6000,
  p_duration_days => 365
) as id into temp t_plan_y2;

select public.create_subscription_plan(
  p_name => 'PGTAP PlanBind Inactive',
  p_year_id => (select year_id from curriculum),
  p_price => 1000,
  p_duration_days => 90,
  p_is_active => false
) as id into temp t_plan_inactive;

grant select on t_plan_y1, t_plan_y2, t_plan_inactive to anon, authenticated;

------------------------------------------------------------------
-- 1. Valid plan/year for enrolled class → succeeds; stores exact plan_id
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key1;
grant select on t_key1 to anon, authenticated;

select lives_ok(
  format(
    $$select public.create_subscription_application(
      5000,
      %L,
      %L::uuid,
      'PKR',
      %L::uuid
    )$$,
    (select key from t_key1),
    (select id from t_plan_y1),
    (select year_id from curriculum)
  ),
  '1 valid plan/year application succeeds'
);

select is(
  (
    select plan_id
    from public.subscription_applications
    where student_id = (select id from t_student)
      and status = 'pending'
    limit 1
  ),
  (select id from t_plan_y1),
  '1b application stores the exact submitted plan_id'
);

select is(
  (
    select amount
    from public.subscription_applications
    where student_id = (select id from t_student)
      and status = 'pending'
    limit 1
  ),
  5000::numeric,
  '1c application amount remains the submitted transfer amount'
);

-- Capture pending app id for later update tests.
select id as id into temp t_app
  from public.subscription_applications
  where student_id = (select id from t_student) and status = 'pending'
  limit 1;
grant select on t_app to anon, authenticated;

------------------------------------------------------------------
-- 2. Cross-year plan → plan_year_mismatch
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key2;
grant select on t_key2 to anon, authenticated;

-- Cancel the pending app so we can create again (unique pending).
select test_helpers.as_runner();
select set_config('medverse.subscription_application_rpc', '1', true);
update public.subscription_applications
set status = 'cancelled'
where id = (select id from t_app);
select set_config('medverse.subscription_application_rpc', '', true);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    $$select public.create_subscription_application(
      5000,
      %L,
      %L::uuid,
      'PKR',
      %L::uuid
    )$$,
    (select key from t_key2),
    (select id from t_plan_y2),
    (select year_id from curriculum)
  ),
  'plan_year_mismatch',
  '2 cross-year plan is rejected'
);

------------------------------------------------------------------
-- 3. Inactive plan → plan_inactive
------------------------------------------------------------------
select public.allocate_payment_screenshot_object_key() as key into temp t_key3;
grant select on t_key3 to anon, authenticated;

select throws_ok(
  format(
    $$select public.create_subscription_application(
      5000,
      %L,
      %L::uuid,
      'PKR',
      %L::uuid
    )$$,
    (select key from t_key3),
    (select id from t_plan_inactive),
    (select year_id from curriculum)
  ),
  'plan_inactive',
  '3 inactive plan is rejected'
);

------------------------------------------------------------------
-- 4. Plan for a year the student is not enrolled in → year_access_denied
------------------------------------------------------------------
select public.allocate_payment_screenshot_object_key() as key into temp t_key4;
grant select on t_key4 to anon, authenticated;

select throws_ok(
  format(
    $$select public.create_subscription_application(
      5000,
      %L,
      %L::uuid,
      'PKR',
      %L::uuid
    )$$,
    (select key from t_key4),
    (select id from t_plan_y2),
    (select id from t_year2)
  ),
  'year_access_denied',
  '4 plan/year for a non-enrolled class is rejected'
);

------------------------------------------------------------------
-- 5. Pending update with cross-year plan → plan_year_mismatch
------------------------------------------------------------------
-- Create a valid pending application again.
select public.allocate_payment_screenshot_object_key() as key into temp t_key5;
grant select on t_key5 to anon, authenticated;

select public.create_subscription_application(
  4500,
  (select key from t_key5),
  (select id from t_plan_y1),
  'PKR',
  (select year_id from curriculum)
) as id into temp t_app2;
grant select on t_app2 to anon, authenticated;

select throws_ok(
  format(
    $$select public.update_pending_subscription_application(
      %L::uuid,
      null,
      null,
      %L::uuid
    )$$,
    (select id from t_app2),
    (select id from t_plan_y2)
  ),
  'plan_year_mismatch',
  '5 pending update with cross-year plan is rejected'
);

-- Confirm the stored plan_id was not mutated.
select is(
  (select plan_id from public.subscription_applications where id = (select id from t_app2)),
  (select id from t_plan_y1),
  '5b rejected update leaves the original plan_id intact'
);

-- Amount unchanged (no silent plan.price substitution).
select is(
  (select amount from public.subscription_applications where id = (select id from t_app2)),
  4500::numeric,
  '5c rejected update leaves the submitted amount intact'
);

select * from finish();
rollback;
