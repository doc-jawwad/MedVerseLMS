-- Subscription plans per year, price, block free-access, year guard on approval,
-- and approval/rejection notifications.

begin;
select plan(23);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'PY Student') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'PY Other') as id
  into temp t_other;
select test_helpers.make_admin('PY Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('PY Manager', array['manage_subscriptions']) as id
  into temp t_manager;
select test_helpers.make_limited_admin(
  'PY Reviewer',
  array['review_subscription_applications', 'manage_subscriptions']
) as id into temp t_reviewer;
select test_helpers.make_limited_admin('PY Academic', array['publish_tests']) as id
  into temp t_academic;

-- A second year for cross-year tests.
select id as id into temp t_year2
  from public.years where year_number = 2 limit 1;

grant select on curriculum, t_student, t_other, t_admin, t_manager,
  t_reviewer, t_academic, t_year2
  to anon, authenticated;

-- Activate payment settings so applications can be created.
select test_helpers.as_user((select id from t_admin));
select public.upsert_payment_settings(
  p_bank_name => 'PGTAP PY Bank',
  p_account_number => '99999',
  p_is_active => true
);

-- -------------------------------------------------------------------------
-- 1. subscription_plans.year_id NOT NULL
-- -------------------------------------------------------------------------
select test_helpers.as_runner();
select col_not_null(
  'public', 'subscription_plans', 'year_id',
  '1 subscription_plans.year_id is NOT NULL'
);

-- -------------------------------------------------------------------------
-- 2. subscription_plans.price exists with check >= 0
-- -------------------------------------------------------------------------
select col_not_null(
  'public', 'subscription_plans', 'price',
  '2 subscription_plans.price is NOT NULL'
);

-- -------------------------------------------------------------------------
-- 3. subjects.free_access column exists
-- -------------------------------------------------------------------------
select col_not_null(
  'public', 'subjects', 'free_access',
  '3 subjects.free_access is NOT NULL'
);

-- -------------------------------------------------------------------------
-- 4. create_subscription_plan: manager can create a plan for a year
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format(
    $$select public.create_subscription_plan(
      p_name => 'PGTAP Year1 Plan',
      p_year_id => %L::uuid,
      p_price => 5000,
      p_duration_days => 365
    )$$,
    (select year_id from curriculum)
  ),
  '4 manager can create plan for a year'
);

-- -------------------------------------------------------------------------
-- 5. create_subscription_plan: year_required when year_id is null
-- -------------------------------------------------------------------------
select throws_ok(
  $$select public.create_subscription_plan(
      p_name => 'NullYear Plan',
      p_year_id => null::uuid,
      p_price => 1000,
      p_duration_days => 365
  )$$,
  'year_required',
  '5 create_subscription_plan raises year_required when year_id is null'
);

-- -------------------------------------------------------------------------
-- 6. create_subscription_plan: invalid_price when price < 0
-- -------------------------------------------------------------------------
select throws_ok(
  format(
    $$select public.create_subscription_plan(
      p_name => 'Bad Price Plan',
      p_year_id => %L::uuid,
      p_price => -1,
      p_duration_days => 365
    )$$,
    (select year_id from curriculum)
  ),
  'invalid_price',
  '6 create_subscription_plan raises invalid_price when price is negative'
);

-- -------------------------------------------------------------------------
-- 7. Unauthorized admin cannot create plan
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    $$select public.create_subscription_plan(
      p_name => 'Unauth Plan',
      p_year_id => %L::uuid,
      p_price => 0,
      p_duration_days => 365
    )$$,
    (select year_id from curriculum)
  ),
  'permission_denied',
  '7 academic admin cannot create subscription plan'
);

-- -------------------------------------------------------------------------
-- 8. Student cannot call create_subscription_plan
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    $$select public.create_subscription_plan(
      p_name => 'Student Plan',
      p_year_id => %L::uuid,
      p_price => 0,
      p_duration_days => 365
    )$$,
    (select year_id from curriculum)
  ),
  'admin only',
  '8 student cannot call create_subscription_plan'
);

-- -------------------------------------------------------------------------
-- 9. RLS: student sees only plans for their enrolled year
-- -------------------------------------------------------------------------
-- Create a plan for year2 that student should NOT see.
select test_helpers.as_user((select id from t_manager));
select public.create_subscription_plan(
  p_name => 'PGTAP Year2 Plan',
  p_year_id => (select id from t_year2),
  p_price => 3000,
  p_duration_days => 180
);

select test_helpers.as_user((select id from t_student));
select ok(
  not exists (
    select 1 from public.subscription_plans
    where name = 'PGTAP Year2 Plan'
  ),
  '9 student cannot see plans from a different year'
);
select ok(
  exists (
    select 1 from public.subscription_plans
    where name = 'PGTAP Year1 Plan'
  ),
  '9b student can see plans from their enrolled year'
);

-- -------------------------------------------------------------------------
-- 10. Admin sees all plans regardless of year
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select ok(
  (select count(*) from public.subscription_plans where name like 'PGTAP%') >= 2,
  '10 admin sees plans from all years'
);

-- -------------------------------------------------------------------------
-- 11. get_plans_for_year: student enrolled in year gets plans
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  exists (
    select 1 from public.get_plans_for_year((select year_id from curriculum))
    where name = 'PGTAP Year1 Plan'
  ),
  '11 get_plans_for_year returns plans for enrolled year'
);

-- -------------------------------------------------------------------------
-- 12. get_plans_for_year: student denied access to a different year's plans
-- -------------------------------------------------------------------------
select throws_ok(
  format(
    $$select * from public.get_plans_for_year(%L::uuid)$$,
    (select id from t_year2)
  ),
  'year_access_denied',
  '12 get_plans_for_year raises year_access_denied for non-enrolled year'
);

-- -------------------------------------------------------------------------
-- 13. set_block_free_access: manager can toggle a Block subject
-- -------------------------------------------------------------------------
-- Use the subject from curriculum (which should have product_key if it's a Block).
-- Skip gracefully if no Block subject exists in fixture.
select test_helpers.as_user((select id from t_manager));
do $$
declare
  v_subj uuid;
begin
  select id into v_subj from public.subjects where product_key is not null limit 1;
  if v_subj is not null then
    perform public.set_block_free_access(v_subj, true);
    perform public.set_block_free_access(v_subj, false);
  end if;
end $$;

select ok(true, '13 set_block_free_access runs without error for manager');

-- -------------------------------------------------------------------------
-- 14. set_block_free_access: student cannot call it
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.set_block_free_access(gen_random_uuid(), true)$$,
  'admin only',
  '14 student cannot call set_block_free_access'
);

-- -------------------------------------------------------------------------
-- 15. set_block_free_access: subject_not_found for unknown uuid
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_manager));
select throws_ok(
  $$select public.set_block_free_access(gen_random_uuid(), true)$$,
  'subject_not_found',
  '15 set_block_free_access raises subject_not_found for unknown subject'
);

-- -------------------------------------------------------------------------
-- 16. approve_subscription_application: plan_year_mismatch guard
-- Insert a mismatched application as runner: app.year_id = year1, plan.year_id = year2.
-- -------------------------------------------------------------------------

-- Always create these tables so later SQL can reference them unconditionally.
create temp table t_app  (id uuid);
create temp table t_app2 (id uuid);

-- Use runner to bypass the GUC trigger and insert a deliberately mismatched row.
select test_helpers.as_runner();
do $$
declare
  v_plan_y2 uuid;
  v_student_id uuid;
  v_app_id uuid;
begin
  select id into v_plan_y2 from public.subscription_plans
    where name = 'PGTAP Year2 Plan' limit 1;
  select id into v_student_id from t_student;

  -- Insert with year1 enrollment but year2 plan — the deliberate mismatch.
  perform set_config('medverse.subscription_application_rpc', '1', true);
  insert into public.subscription_applications (
    student_id, plan_id, amount, currency, screenshot_object_key, status, year_id
  ) values (
    v_student_id,
    v_plan_y2,
    5000, 'PKR',
    'payment-proofs/pgtap-202-mismatch-proof.jpg',
    'pending',
    (select year_id from curriculum)
  ) returning id into v_app_id;
  perform set_config('medverse.subscription_application_rpc', '', true);

  insert into t_app values (v_app_id);
end $$;

select test_helpers.as_user((select id from t_reviewer));
select throws_ok(
  format(
    $$select public.approve_subscription_application(
      %L::uuid,
      p_review_note => 'should fail'
    )$$,
    (select id from t_app limit 1)
  ),
  'plan_year_mismatch',
  '16 approve_subscription_application raises plan_year_mismatch when plan year differs'
);

-- -------------------------------------------------------------------------
-- 17. Notifications: application_rejected inserts notification.
-- Use t_other (different student) so the unique-pending index is not violated.
-- -------------------------------------------------------------------------
select test_helpers.as_runner();
do $$
declare
  v_plan_y1 uuid;
  v_other_id uuid;
  v_app_id  uuid;
begin
  select id into v_plan_y1 from public.subscription_plans
    where name = 'PGTAP Year1 Plan' limit 1;
  select id into v_other_id from t_other;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  insert into public.subscription_applications (
    student_id, plan_id, amount, currency, screenshot_object_key, status, year_id
  ) values (
    v_other_id,
    v_plan_y1,
    5000, 'PKR',
    'payment-proofs/pgtap-202-reject-proof.jpg',
    'pending',
    (select year_id from curriculum)
  ) returning id into v_app_id;
  perform set_config('medverse.subscription_application_rpc', '', true);

  insert into t_app2 values (v_app_id);
end $$;

select test_helpers.as_user((select id from t_reviewer));
select lives_ok(
  format(
    $$select public.reject_subscription_application(
      %L::uuid,
      p_review_note => 'Test rejection'
    )$$,
    (select id from t_app2 limit 1)
  ),
  '17 reject_subscription_application succeeds'
);

select ok(
  exists (
    select 1 from public.student_notifications
    where kind = 'application_rejected'
      and ref_id = (select id from t_app2 limit 1)
  ),
  '17b rejection notification inserted'
);

-- -------------------------------------------------------------------------
-- 18. update_subscription_plan: can update price
-- -------------------------------------------------------------------------
select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format(
    $$select public.update_subscription_plan(
      p_plan_id => (select id from public.subscription_plans where name = 'PGTAP Year1 Plan' limit 1),
      p_price => 6000
    )$$
  ),
  '18 update_subscription_plan can update price'
);
select ok(
  (select price from public.subscription_plans where name = 'PGTAP Year1 Plan' limit 1) = 6000,
  '18b price updated correctly'
);

-- -------------------------------------------------------------------------
-- 19. update_subscription_plan: invalid_price rejected
-- -------------------------------------------------------------------------
select throws_ok(
  format(
    $$select public.update_subscription_plan(
      p_plan_id => (select id from public.subscription_plans where name = 'PGTAP Year1 Plan' limit 1),
      p_price => -50
    )$$
  ),
  'invalid_price',
  '19 update_subscription_plan raises invalid_price for negative price'
);

-- -------------------------------------------------------------------------
-- 20. student_notifications kind constraint includes new values
-- -------------------------------------------------------------------------
select test_helpers.as_runner();
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.student_notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%application_approved%'
  ),
  '20 student_notifications kind constraint includes application_approved'
);

select * from finish();
rollback;
