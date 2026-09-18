-- Subscription grace (0/1/2 days), expiry warnings, restore-during-grace.

begin;
select plan(18);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_student as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'grace-st@test.invalid', 'Grace Student', 'student', 'active')
  returning id
) select id from ins;
create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'grace-ad@test.invalid', 'Grace Admin', 'admin', 'active', true)
  returning id
) select id from ins;

insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select year_id from curriculum), 'active');

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

insert into public.tests (
  title, year_id, subject_id, status, opens_at, closes_at, entitlement
) values (
  'GRACE_paid',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  now() - interval '1 hour',
  now() + interval '7 days',
  'free'
);
insert into public.test_audiences (test_id, year_id)
select id, year_id from public.tests where title = 'GRACE_paid';
create temp table t_paid as
select id from public.tests where title = 'GRACE_paid';

insert into public.tests (
  title, year_id, subject_id, status, opens_at, closes_at, entitlement
) values (
  'GRACE_free',
  (select year_id from curriculum),
  (select subject_id from curriculum),
  'published',
  now() - interval '1 hour',
  now() + interval '7 days',
  'free'
);
insert into public.test_audiences (test_id, year_id)
select id, year_id from public.tests where title = 'GRACE_free';
create temp table t_free as
select id from public.tests where title = 'GRACE_free';

create temp table t_sub (id uuid);
grant select on curriculum, t_student, t_admin, t_std, t_paid, t_free, t_sub
  to anon, authenticated;
grant insert on t_sub to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'test', (select id from t_paid), 'any_subscription'
);
select lives_ok(
  $$select public.upsert_payment_settings(p_subscription_grace_days => 1, p_is_active => true)$$,
  'admin can set tenant grace to 1 day'
);
select is(public.tenant_subscription_grace_days(), 1, 'tenant default grace is 1');

select throws_ok(
  format(
    'select public.activate_subscription(%L, %L, now() - interval ''2 days'', now() - interval ''1 hour'', null, 0)',
    (select id from t_student),
    (select id from t_std)
  ),
  'subscription_already_ended',
  '0-day grace rejects a window that already ended'
);

insert into t_sub (id)
select public.activate_subscription(
  (select id from t_student),
  (select id from t_std),
  now() - interval '2 days',
  now() - interval '30 minutes',
  null,
  1,
  'all_entitled'
);

select test_helpers.as_user((select id from t_student));
select ok(public.has_live_subscription(), '1-day grace keeps paid access after ends_at');
select ok(
  public.can_access_test((select id from t_paid))
  and public.can_access_test((select id from t_free)),
  'during grace paid and free tests stay usable'
);

select is(
  public.subscription_expiry_warning_kind(now() + interval '12 hours', now()),
  'subscription_expiry_1d',
  'warning kind is 1d inside the last day'
);
select is(
  public.subscription_expiry_warning_kind(now() + interval '2 days', now()),
  'subscription_expiry_3d',
  'warning kind is 3d inside three days'
);
select is(
  public.subscription_expiry_warning_kind(now() + interval '6 days', now()),
  'subscription_expiry_7d',
  'warning kind is 7d inside seven days'
);
select ok(
  public.subscription_expiry_warning_kind(now() - interval '1 hour', now()) is null,
  'no pre-expiry warning after ends_at'
);

select test_helpers.as_user((select id from t_admin));
select public.emit_subscription_expiry_warnings((select id from t_student));
-- already past ends_at: no warning rows
select is(
  (select count(*)::int from public.student_notifications
    where student_id = (select id from t_student)),
  0,
  'warnings are not inserted after ends_at'
);

select public.set_subscription_access((select id from t_sub), 0, 'all_entitled');
select test_helpers.as_user((select id from t_student));
select ok(
  (not public.has_live_subscription())
  and (not public.can_access_test((select id from t_paid)))
  and public.can_access_test((select id from t_free)),
  '0-day grace locks paid resources immediately; free stays open'
);

select test_helpers.as_user((select id from t_admin));
select public.set_subscription_access((select id from t_sub), 2, 'all_entitled');
select test_helpers.as_user((select id from t_student));
select ok(
  public.has_live_subscription()
  and public.can_access_test((select id from t_paid)),
  '2-day grace keeps paid access after ends_at'
);

select test_helpers.as_user((select id from t_admin));
select public.set_subscription_end((select id from t_sub), now() + interval '10 days');
select public.extend_subscription((select id from t_sub), 5);
select test_helpers.as_user((select id from t_student));
select ok(public.has_live_subscription(), 'set end plus renewal from existing end restores live access');

select test_helpers.as_runner();
create temp table t_warn as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'grace-warn@test.invalid', 'Warn', 'student', 'active')
  returning id
) select id from ins;
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_warn), (select year_id from curriculum), 'active');
grant select on t_warn to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.activate_subscription(
  (select id from t_warn),
  (select id from t_std),
  now(),
  now() + interval '2 days 12 hours',
  null,
  2
);
select is(public.emit_subscription_expiry_warnings((select id from t_warn)), 2,
  '7d and 3d warnings insert for a 2.5-day remaining window');
select is(
  (select count(*)::int from public.student_notifications
    where student_id = (select id from t_warn)
      and kind in ('subscription_expiry_7d', 'subscription_expiry_3d')),
  2,
  'warning uniqueness stores both 7d and 3d once'
);

select is(public.expire_due_subscriptions((select id from t_warn)), 0,
  'expire_due does not expire a still-live (including 2-day grace) row');

select test_helpers.as_user((select id from t_student));
select lives_ok(
  format(
    'update public.subscriptions set ends_at = now() + interval ''1 year'' where id = %L',
    (select id from t_sub)
  ),
  'student UPDATE does not raise (RLS matches zero rows)'
);
select test_helpers.as_runner();
select ok(
  (select ends_at < now() + interval '20 days' from public.subscriptions where id = (select id from t_sub)),
  'student cannot extend ends_at via direct PostgREST update'
);

select * from finish();
rollback;
