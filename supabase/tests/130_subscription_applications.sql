-- Step 8F subscription applications, payment settings, screenshot key authz.

begin;
select plan(49);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'App Student') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'App Other') as id
  into temp t_other;
select test_helpers.make_admin('App Main Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('App Reviewer', array['review_subscription_applications']) as id
  into temp t_reviewer;
select test_helpers.make_limited_admin('App Sub Manager', array['manage_subscriptions']) as id
  into temp t_manager;
select test_helpers.make_limited_admin(
  'App Full Review',
  array['review_subscription_applications', 'manage_subscriptions']
) as id into temp t_full;
select test_helpers.make_limited_admin('App Academic', array['publish_tests']) as id
  into temp t_academic;
select test_helpers.make_limited_admin('App Pay Admin', array['manage_payment_settings']) as id
  into temp t_pay;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on curriculum, t_student, t_other, t_admin, t_reviewer, t_manager,
  t_full, t_academic, t_pay, t_std
  to anon, authenticated;

-- The VPS staging database can have a real active singleton. Isolate this
-- transaction-scoped fixture through the approved RPC; ROLLBACK restores it.
select test_helpers.as_user((select id from t_pay));
select public.upsert_payment_settings(
  p_bank_name => 'PGTAP inactive baseline',
  p_is_active => false
);

------------------------------------------------------------------
-- 16/17 payment settings
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.get_payment_instructions() is null,
  '16 inactive payment settings are not student-readable as instructions'
);

select test_helpers.as_user((select id from t_academic));
select throws_ok(
  $$select public.upsert_payment_settings(p_bank_name => 'HBL', p_is_active => true)$$,
  'permission_denied',
  '17 unauthorized admin cannot modify payment settings'
);

select test_helpers.as_user((select id from t_pay));
select lives_ok(
  $$select public.upsert_payment_settings(
    p_bank_name => 'HBL',
    p_account_title => 'MedVerse',
    p_account_number => '12345',
    p_iban => 'PK00HBL00000000000012345',
    p_payment_instructions => 'Transfer and upload screenshot',
    p_qr_reference => 'MV-SUB',
    p_currency => 'PKR',
    p_is_active => true
  )$$,
  '17b manage_payment_settings admin can upsert payment settings'
);

select test_helpers.as_user((select id from t_student));
select is(
  public.get_payment_instructions() ->> 'bank_name',
  'HBL',
  '16b student can read the active payment copy via RPC'
);
select is(
  public.get_payment_instructions() ->> 'currency',
  'PKR',
  '16c payment instructions use owner default currency PKR'
);

select test_helpers.as_user((select id from t_admin));
select public.activate_subscription((select id from t_student), (select id from t_std));
select public.set_account_status((select id from t_student), 'restricted');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  '16e restricted account cannot read payment instructions even with a live subscription'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'active');
select test_helpers.as_user((select id from t_student));
select is(
  public.get_payment_instructions() ->> 'bank_name',
  'HBL',
  '16f restored active account can read payment instructions again'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'suspended');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  '16g suspended account cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'deactivated');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  '16h deactivated account cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'revoked');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  '16i revoked account cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'active');
select public.deactivate_subscription((
  select id from public.subscriptions
  where student_id = (select id from t_student) and status = 'active'
  limit 1
));
select test_helpers.as_user((select id from t_student));
select is(
  public.get_payment_instructions() ->> 'bank_name',
  'HBL',
  '16j non-live subscription does not block payment instructions for an active account'
);

select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.payment_settings),
  0,
  '16d student has no direct SELECT on payment_settings'
);

------------------------------------------------------------------
-- 1/7/8 student create
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key;
grant select on t_key to anon, authenticated;

select ok(
  (select key from t_key) like 'payment-proofs/%'
  and (select key from t_key) !~* '://',
  '8 allocated screenshot object key is private metadata, not a public URL'
);

select throws_ok(
  format(
    'select public.create_subscription_application(0, %L)',
    (select key from t_key)
  ),
  'invalid_amount',
  '7 payment amount must be greater than zero'
);

select public.create_subscription_application(
  1500,
  (select key from t_key)
) as id into temp t_app;
grant select on t_app to anon, authenticated;

select is(
  (select status from public.subscription_applications where id = (select id from t_app)),
  'pending',
  '1 student can create own pending application'
);
select is(
  (select currency from public.subscription_applications where id = (select id from t_app)),
  'PKR',
  '1b omitted currency defaults to PKR'
);
select is(
  (select plan_id from public.subscription_applications where id = (select id from t_app)),
  (select id from t_std),
  '1c omitted plan_id resolves to the current active plan'
);

------------------------------------------------------------------
-- 2/14 second pending rejected
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key2;
grant select on t_key2 to anon, authenticated;
select throws_ok(
  format(
    'select public.create_subscription_application(2000, %L)',
    (select key from t_key2)
  ),
  'application_already_pending',
  '2 student cannot create a second pending application'
);

------------------------------------------------------------------
-- 3/18 tenant/student isolation
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select is(
  (select count(*)::int from public.subscription_applications where id = (select id from t_app)),
  0,
  '3 student cannot read another student application'
);

------------------------------------------------------------------
-- 5 student cannot modify review fields / 6 cannot mutate subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select lives_ok(
  format(
    'update public.subscription_applications set status = %L, reviewed_by = %L where id = %L',
    'approved',
    (select id from t_student),
    (select id from t_app)
  ),
  '5 student UPDATE is not an error (RLS matches zero rows)'
);
select is(
  (select status from public.subscription_applications where id = (select id from t_app)),
  'pending',
  '5b student cannot modify review/status fields'
);

select throws_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_student),
    (select id from t_std)
  ),
  'admin only',
  '6 student cannot manipulate subscription via application path'
);

select throws_ok(
  format(
    'select public.approve_subscription_application(%L)',
    (select id from t_app)
  ),
  'admin only',
  '4 student cannot approve'
);
select throws_ok(
  format(
    'select public.reject_subscription_application(%L)',
    (select id from t_app)
  ),
  'admin only',
  '4b student cannot reject'
);

------------------------------------------------------------------
-- 9/10/11 review vs subscription permission
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'select public.reject_subscription_application(%L)',
    (select id from t_app)
  ),
  'permission_denied',
  '9 unauthorized admin cannot review application'
);

select test_helpers.as_user((select id from t_manager));
select throws_ok(
  format(
    'select public.reject_subscription_application(%L)',
    (select id from t_app)
  ),
  'permission_denied',
  '11 manage_subscriptions alone cannot review'
);
select throws_ok(
  format(
    'select public.approve_subscription_application(%L)',
    (select id from t_app)
  ),
  'permission_denied',
  '11b manage_subscriptions without review cannot approve'
);

select test_helpers.as_user((select id from t_reviewer));
select throws_ok(
  format(
    'select public.approve_subscription_application(%L)',
    (select id from t_app)
  ),
  'permission_denied',
  '11c review without manage_subscriptions cannot activate via approve'
);
select lives_ok(
  format(
    'select public.reject_subscription_application(%L, %L)',
    (select id from t_app),
    'unclear screenshot'
  ),
  '10 review permission allows reject'
);

-- Reviewer lacks manage_subscriptions SELECT; assert as runner.
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.subscriptions where student_id = (select id from t_student)),
  1,
  '13 rejection does not add a subscription beyond the earlier deactivated fixture'
);

------------------------------------------------------------------
-- 15 rejected student can submit a new application
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key3;
grant select on t_key3 to anon, authenticated;
select public.create_subscription_application(
  1800,
  (select key from t_key3),
  (select id from t_std),
  'PKR'
) as id into temp t_app2;
grant select on t_app2 to anon, authenticated;

select is(
  (select count(*)::int from public.subscription_applications
    where student_id = (select id from t_student) and status = 'pending'),
  1,
  '14/15 one pending application after resubmit'
);

select test_helpers.as_user((select id from t_student));
select lives_ok(
  format(
    'select public.update_pending_subscription_application(%L, 1900)',
    (select id from t_app2)
  ),
  'pending application can be edited in place'
);
select is(
  (select amount from public.subscription_applications where id = (select id from t_app2)),
  1900::numeric,
  'pending edit updates amount on the same row'
);

------------------------------------------------------------------
-- 20 screenshot authorization
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select throws_ok(
  format(
    'select public.authorize_payment_screenshot_access(%L, %L)',
    (select id from t_app2),
    'read'
  ),
  'screenshot_access_denied',
  '20 other student cannot obtain the R2 object key'
);

select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'select public.authorize_payment_screenshot_access(%L, %L)',
    (select id from t_app2),
    'read'
  ),
  'screenshot_access_denied',
  '20b unauthorized admin cannot obtain the R2 object key'
);

select test_helpers.as_user((select id from t_student));
select is(
  public.authorize_payment_screenshot_access((select id from t_app2), 'read'),
  (select screenshot_object_key from public.subscription_applications where id = (select id from t_app2)),
  '20c owner can authorize read of own pending screenshot key'
);

select test_helpers.as_user((select id from t_reviewer));
select ok(
  public.authorize_payment_screenshot_access((select id from t_app2), 'read')
    like 'payment-proofs/%',
  '20d review permission can authorize screenshot read'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.create_subscription_application(100, %L)',
    'https://cdn.example/proof.png'
  ),
  'invalid_screenshot_object_key',
  '8c public URL is rejected as a screenshot object key'
);

------------------------------------------------------------------
-- 12 approval creates live subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_full));
select public.approve_subscription_application((select id from t_app2), 'paid') as id
  into temp t_sub;
grant select on t_sub to anon, authenticated;

select is(
  (select status from public.subscription_applications where id = (select id from t_app2)),
  'approved',
  '12 application is approved'
);
select is(
  (select status from public.subscriptions where id = (select id from t_sub)),
  'active',
  '12b approval creates an active subscription'
);
select is(
  (select application_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_app2),
  '12c subscription is linked to the approved application'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.has_live_subscription(),
  '12d approved application yields a live subscription'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.update_pending_subscription_application(%L, 50)',
    (select id from t_app2)
  ),
  'application_not_pending',
  'approved historical row cannot be mutated by the student'
);

------------------------------------------------------------------
-- 19 audit
------------------------------------------------------------------
select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'subscription_application_approved'
      and target_id = (select id from t_app2)
  ),
  '19 approval is audited'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'subscription_application_rejected'
      and target_id = (select id from t_app)
  ),
  '19b rejection is audited'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'payment_settings_updated'
  ),
  '19c payment settings change is audited'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'subscription_activated'
      and target_id = (select id from t_sub)
  ),
  '19d subscription activation caused by approval is audited'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.log_audit('forged', 'subscription_application', gen_random_uuid())$$,
  'admin only',
  '19e student cannot forge audit rows'
);

select test_helpers.as_runner();
select ok(
  (
    select prosecdef and proconfig::text like '%search_path=public%'
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'approve_subscription_application'
  ),
  'new application SECURITY DEFINER functions set search_path = public'
);

select * from finish();
rollback;
