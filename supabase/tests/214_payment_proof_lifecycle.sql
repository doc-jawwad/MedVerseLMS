-- Payment-proof release on subscription end: clear key + enqueue if unreferenced.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Proof Lifecycle Admin') as id into temp t_admin;
select test_helpers.make_student((select year_id from curriculum), 'Proof Lifecycle Student') as id
  into temp t_student;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
where id = (select id from t_admin);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
where id = (select id from t_student);

-- Active paid plan for curriculum year
with ins as (
  insert into public.subscription_plans (
    name, year_id, price, duration_days, is_active, is_complimentary, sort_order
  )
  values (
    'Proof Plan',
    (select year_id from curriculum),
    1000,
    30,
    true,
    false,
    1
  )
  returning id
)
select id into temp t_plan from ins;

grant select on curriculum, t_admin, t_student, t_plan to anon, authenticated;

-- Application + active subscription linked via application_id
select set_config('medverse.subscription_application_rpc', '1', true);
with ins as (
  insert into public.subscription_applications (
    student_id, plan_id, year_id, amount, currency, screenshot_object_key, status,
    reviewed_by, reviewed_at
  )
  values (
    (select id from t_student),
    (select id from t_plan),
    (select year_id from curriculum),
    1000,
    'PKR',
    'payment-proofs/00000000-0000-0000-0000-000000000001/' ||
      (select id from t_student)::text || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'approved',
    (select id from t_admin),
    now()
  )
  returning id, screenshot_object_key
)
select id, screenshot_object_key into temp t_app from ins;
select set_config('medverse.subscription_application_rpc', '', true);

with ins as (
  insert into public.subscriptions (
    student_id, plan_id, year_id, status, starts_at, ends_at, grace_days,
    application_id, activated_by, activated_at
  )
  values (
    (select id from t_student),
    (select id from t_plan),
    (select year_id from curriculum),
    'active',
    now() - interval '1 day',
    now() + interval '10 days',
    0,
    (select id from t_app),
    (select id from t_admin),
    now() - interval '1 day'
  )
  returning id
)
select id into temp t_sub from ins;

grant select on t_app, t_sub to anon, authenticated;

-- Active subscription retains proof (release is a no-op while live)
select test_helpers.as_runner();
select lives_ok(
  $$select public.release_subscription_payment_proof((select id from t_sub))$$,
  'release while live is a no-op'
);
select ok(
  (
    select screenshot_object_key is not null
    from public.subscription_applications
    where id = (select id from t_app)
  ),
  'active subscription keeps screenshot_object_key'
);

-- Admin deactivate releases proof
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  $$select public.deactivate_subscription((select id from t_sub))$$,
  'deactivate active subscription'
);

select test_helpers.as_runner();
select ok(
  (
    select screenshot_object_key is null
    from public.subscription_applications
    where id = (select id from t_app)
  ),
  'deactivate clears screenshot_object_key'
);
select ok(
  exists (
    select 1 from public.r2_purge_queue
    where object_key = (
      'payment-proofs/00000000-0000-0000-0000-000000000001/' ||
      (select id from t_student)::text || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    )
    and completed_at is null
  ),
  'deactivate enqueues payment-proof for purge'
);
select ok(
  exists (select 1 from public.subscriptions where id = (select id from t_sub)),
  'subscription history row remains after deactivate'
);
select ok(
  exists (select 1 from public.subscription_applications where id = (select id from t_app)),
  'application history row remains after deactivate'
);

-- Natural expiry path
select set_config('medverse.subscription_application_rpc', '1', true);
with ins as (
  insert into public.subscription_applications (
    student_id, plan_id, year_id, amount, currency, screenshot_object_key, status
  )
  values (
    (select id from t_student),
    (select id from t_plan),
    (select year_id from curriculum),
    1000,
    'PKR',
    'payment-proofs/00000000-0000-0000-0000-000000000001/' ||
      (select id from t_student)::text || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'approved'
  )
  returning id
)
select id into temp t_app2 from ins;
select set_config('medverse.subscription_application_rpc', '', true);

with ins as (
  insert into public.subscriptions (
    student_id, plan_id, year_id, status, starts_at, ends_at, grace_days,
    application_id
  )
  values (
    (select id from t_student),
    (select id from t_plan),
    (select year_id from curriculum),
    'active',
    now() - interval '40 days',
    now() - interval '2 days',
    0,
    (select id from t_app2)
  )
  returning id
)
select id into temp t_sub2 from ins;

grant select on t_app2, t_sub2 to anon, authenticated;

select is(
  public.expire_due_subscriptions((select id from t_student)),
  1,
  'expire_due_subscriptions expires one due row'
);
select ok(
  (
    select screenshot_object_key is null
    from public.subscription_applications
    where id = (select id from t_app2)
  ),
  'natural expiry clears screenshot_object_key'
);
select ok(
  exists (
    select 1 from public.r2_purge_queue
    where object_key = (
      'payment-proofs/00000000-0000-0000-0000-000000000001/' ||
      (select id from t_student)::text || '/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    )
    and completed_at is null
  ),
  'natural expiry enqueues payment-proof for purge'
);

select * from finish();
rollback;
