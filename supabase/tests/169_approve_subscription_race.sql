-- Check 4 F4: concurrent/replayed approval is claim-first; grace-live extend.
begin;
select plan(11);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'F4 Student') as id
  into temp t_student;
select test_helpers.make_limited_admin(
  'F4 Full Review',
  array['review_subscription_applications', 'manage_subscriptions', 'manage_payment_settings']
) as id into temp t_full;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on curriculum, t_student, t_full, t_std to anon, authenticated;

select test_helpers.as_user((select id from t_full));
select public.upsert_payment_settings(
  p_bank_name => 'F4 Bank',
  p_account_title => 'MedVerse',
  p_account_number => '999',
  p_iban => 'PK00F4000000000000000999',
  p_payment_instructions => 'pay',
  p_currency => 'PKR',
  p_is_active => true,
  p_subscription_grace_days => 1
);

------------------------------------------------------------------
-- Seed pending application + live subscription (pre-ends_at)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key;
grant select on t_key to anon, authenticated;

select public.create_subscription_application(
  1500,
  (select key from t_key),
  (select id from t_std)
) as id into temp t_app;
grant select on t_app to anon, authenticated;

select test_helpers.as_user((select id from t_full));
select public.activate_subscription(
  (select id from t_student),
  (select id from t_std),
  now() - interval '10 days',
  now() + interval '20 days',
  null,
  1
) as id into temp t_sub;
grant select on t_sub to anon, authenticated;

select ends_at as ends_at into temp t_ends0
from public.subscriptions where id = (select id from t_sub);
grant select on t_ends0 to anon, authenticated;

select duration_days as days into temp t_days
from public.subscription_plans where id = (select id from t_std);
grant select on t_days to anon, authenticated;

------------------------------------------------------------------
-- First approve extends exactly once
------------------------------------------------------------------
select public.approve_subscription_application((select id from t_app), 'ok') as id
  into temp t_approved;
grant select on t_approved to anon, authenticated;

select is(
  (select status from public.subscription_applications where id = (select id from t_app)),
  'approved',
  'first approve claims pending → approved'
);
select is(
  (select id from t_approved),
  (select id from t_sub),
  'first approve extends the existing live subscription'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_sub)),
  (select ends_at + make_interval(days => (select days from t_days)) from t_ends0),
  'first approve extends ends_at by exactly one plan duration'
);

------------------------------------------------------------------
-- Concurrent/replayed approve must fail without a second extension
------------------------------------------------------------------
select throws_ok(
  format(
    'select public.approve_subscription_application(%L, %L)',
    (select id from t_app),
    'replay'
  ),
  'application_not_pending',
  'replayed/concurrent approve fails as application_not_pending'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_sub)),
  (select ends_at + make_interval(days => (select days from t_days)) from t_ends0),
  'replay does not extend the subscription a second time'
);

-- Structure: claim (approved update) appears before extend/activate in prosrc
select ok(
  (
    select
      position('status = ''approved''' in lower(prosrc)) > 0
      and position('for update' in lower(prosrc)) > 0
      and position('subscription_is_live_at' in lower(prosrc)) > 0
      and position('status = ''approved''' in lower(prosrc))
        < position('extend_subscription' in lower(prosrc))
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'approve_subscription_application'
  ),
  'approve claims pending under FOR UPDATE before extend_subscription'
);

------------------------------------------------------------------
-- Grace-live: past ends_at but within grace → extend, not activate fail
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set
  ends_at = now() - interval '6 hours',
  grace_days = 1,
  status = 'active'
where id = (select id from t_sub);

select ends_at as ends_at into temp t_grace_ends
from public.subscriptions where id = (select id from t_sub);
grant select on t_grace_ends to anon, authenticated;

select test_helpers.as_user((select id from t_student));
select public.allocate_payment_screenshot_object_key() as key into temp t_key2;
grant select on t_key2 to anon, authenticated;
select public.create_subscription_application(
  1600,
  (select key from t_key2),
  (select id from t_std)
) as id into temp t_app_grace;
grant select on t_app_grace to anon, authenticated;

select test_helpers.as_user((select id from t_full));
select lives_ok(
  format(
    'select public.approve_subscription_application(%L)',
    (select id from t_app_grace)
  ),
  'approve during grace extends the grace-live subscription'
);
select is(
  (select id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_sub),
  'grace approval keeps the same subscription row'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_sub)),
  (select ends_at + make_interval(days => (select days from t_days)) from t_grace_ends),
  'grace approval extends from existing ends_at (not now())'
);
select is(
  (select count(*)::int from public.subscriptions
   where student_id = (select id from t_student) and status = 'active'),
  1,
  'grace approval does not insert a second active subscription'
);

select ok(
  (
    select prosecdef and proconfig::text like '%search_path=public%'
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'approve_subscription_application'
  ),
  'approve_subscription_application remains SECURITY DEFINER with search_path=public'
);

select * from finish();
rollback;
