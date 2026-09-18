-- Step 8E subscription plans + lifecycle. Transaction-scoped fixtures.

begin;
select plan(40);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Sub Student') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'Sub Other') as id
  into temp t_other;
select test_helpers.make_student((select year_id from curriculum), 'Sub Grant') as id
  into temp t_grantee;
select test_helpers.make_admin('Sub Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('Sub Manager', array['manage_subscriptions']) as id
  into temp t_manager;
select test_helpers.make_limited_admin('Sub Academic', array['publish_tests']) as id
  into temp t_academic;

select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_free;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_any;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2
) as id into temp t_plan_res;
select test_helpers.make_question((select topic_id from curriculum), 'A');

with ins as (
  insert into public.material_folders (year_id, name)
  values ((select year_id from curriculum), 'PGTAP sub folder')
  returning id
)
select id into temp t_folder from ins;
with ins as (
  insert into public.materials (folder_id, title, drive_url)
  values (
    (select id from t_folder),
    'Paid notes',
    'https://drive.google.com/file/d/pgtap-sub'
  )
  returning id
)
select id into temp t_mat from ins;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on curriculum, t_student, t_other, t_grantee, t_admin, t_manager,
  t_academic, t_free, t_any, t_plan_res, t_folder, t_mat, t_std
  to anon, authenticated;

------------------------------------------------------------------
-- 9) free entitlement remains allowed without a subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_free))
  and not public.has_live_subscription(),
  '9 free entitlement remains allowed without a subscription'
);

------------------------------------------------------------------
-- Paid resources stay locked until live
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement('test', (select id from t_any), 'any_subscription');
select public.set_resource_entitlement('test', (select id from t_plan_res), 'plan', (select id from t_std));
select public.set_resource_entitlement(
  'practice_subject', (select subject_id from curriculum), 'any_subscription'
);
select public.set_resource_entitlement(
  'materials_folder', (select id from t_folder), 'any_subscription'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test((select id from t_any))
  and not public.can_access_test((select id from t_any)),
  'paid test is catalog-visible but locked without a subscription'
);
select ok(
  (not public.has_practice_access((select subject_id from curriculum))),
  'paid practice is denied without a subscription'
);
select ok(
  (not public.can_access_material_folder((select id from t_folder))),
  'paid material is denied without a subscription'
);

------------------------------------------------------------------
-- 1 / 15 / 16 activate
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_student), (select id from t_std)
  ),
  'permission_denied',
  '14 unauthorized admin cannot mutate subscription'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_student), (select id from t_std)
  ),
  'admin only',
  '13b student cannot activate a subscription'
);

select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_student), (select id from t_std)
  ),
  '1/15 manage_subscriptions admin can create one active subscription'
);

select public.activate_subscription(
  (select id from t_other), (select id from t_std)
) as id into temp t_other_sub;
grant select on t_other_sub to authenticated;

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_grantee), (select id from t_std)
  ),
  '16 Main Admin bypass can activate a subscription'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.subscriptions
    where student_id = (select id from t_student) and status = 'active'),
  1,
  '1b exactly one active subscription row exists for the student'
);

select test_helpers.as_user((select id from t_manager));
select throws_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_student), (select id from t_std)
  ),
  'subscription_already_active',
  '2 second active subscription for the same student is rejected'
);

------------------------------------------------------------------
-- 3 / 4 live entitlement
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(public.has_live_subscription(), '3a has_live_subscription is true');
select ok(
  public.can_access_test((select id from t_any))
  and public.has_practice_access((select subject_id from curriculum))
  and public.can_access_material_folder((select id from t_folder)),
  '3 active subscription grants any_subscription resources'
);
select ok(
  public.has_live_plan((select id from t_std))
  and public.can_access_test((select id from t_plan_res)),
  '4 matching plan grants plan entitlement'
);

select test_helpers.as_user((select id from t_admin));
select public.create_subscription_plan('Alt plan', 'other plan', 30, false, true, 1)
  as id into temp t_alt;
grant select on t_alt to authenticated;
select public.set_resource_entitlement(
  'test', (select id from t_plan_res), 'plan', (select id from t_alt)
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.has_live_subscription()
  and not public.has_live_plan((select id from t_alt))
  and not public.can_access_test((select id from t_plan_res)),
  '5 wrong plan denies plan entitlement'
);

select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format(
    'select public.assign_subscription_plan(%L, %L)',
    (select id from public.subscriptions
      where student_id = (select id from t_student) and status = 'active'),
    (select id from t_alt)
  ),
  'assign_subscription_plan switches the live plan'
);
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_plan_res)),
  '4b matching plan after assignment grants access'
);

------------------------------------------------------------------
-- 11 restriction overrides subscription; 12 grant works without subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.restrict_access(
  (select id from t_student), 'test', null, (select id from t_any), null
);
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test((select id from t_any))
  and not public.can_access_test((select id from t_any)),
  '10 individual restriction overrides a live subscription'
);

select test_helpers.as_user((select id from t_admin));
select public.unrestrict_access((
  select id from public.access_restrictions
  where student_id = (select id from t_student)
    and test_id = (select id from t_any)
    and revoked_at is null
));

select test_helpers.as_user((select id from t_admin));
select public.deactivate_subscription((
  select id from public.subscriptions
  where student_id = (select id from t_grantee) and status = 'active'
));
select public.grant_access(
  (select id from t_grantee), 'test', null, (select id from t_any), null
);
select test_helpers.as_user((select id from t_grantee));
select ok(
  (not public.has_live_subscription())
  and public.can_access_test((select id from t_any)),
  '11 individual grant works without a live subscription'
);

------------------------------------------------------------------
-- 8 deactivated denies
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(public.has_live_subscription(), 'precondition: student still live before deactivate');
select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format(
    'select public.deactivate_subscription(%L)',
    (select id from public.subscriptions
      where student_id = (select id from t_student) and status = 'active')
  ),
  'deactivate_subscription succeeds'
);
select test_helpers.as_user((select id from t_student));
select ok(
  (not public.has_live_subscription())
  and not public.can_access_test((select id from t_any)),
  '8 deactivated subscription denies paid access'
);

select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format(
    'select public.restore_subscription(%L)',
    (select id from public.subscriptions
      where student_id = (select id from t_student)
      order by created_at desc limit 1)
  ),
  'restore_subscription reactivates a deactivated window'
);
select test_helpers.as_user((select id from t_student));
select ok(public.has_live_subscription(), 'restored subscription is live again');

------------------------------------------------------------------
-- 17 extension uses current end date
------------------------------------------------------------------
select test_helpers.as_runner();
select ends_at as ends_at, id as id
  into temp t_live
  from public.subscriptions
  where student_id = (select id from t_student) and status = 'active';
grant select on t_live to authenticated;

select test_helpers.as_user((select id from t_manager));
select lives_ok(
  format('select public.extend_subscription(%L, 5)', (select id from t_live)),
  '17 extend_subscription succeeds'
);
select test_helpers.as_runner();
select is(
  (select ends_at from public.subscriptions where id = (select id from t_live)),
  (select ends_at + interval '5 days' from t_live),
  '17b extension is added to the previous ends_at, not now()'
);

------------------------------------------------------------------
-- 6 / 7 expiry: past ends_at denies even if status is still active
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set starts_at = now() - interval '10 days',
    ends_at = now() - interval '1 hour'
where id = (select id from t_live);
select test_helpers.as_user((select id from t_student));
select ok(
  (select status from public.subscriptions where id = (select id from t_live)) = 'active'
  and not public.has_live_subscription()
  and not public.can_access_test((select id from t_any)),
  '6 expired end date denies even if status is still active'
);

select test_helpers.as_user((select id from t_manager));
select is(
  public.expire_due_subscriptions((select id from t_student)),
  1,
  '7 expire_due_subscriptions normalizes the stale active row'
);
select test_helpers.as_runner();
select is(
  (select status from public.subscriptions where id = (select id from t_live)),
  'expired',
  '7b status is expired after normalization'
);

------------------------------------------------------------------
-- 12 blocked account overrides subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.activate_subscription((select id from t_student), (select id from t_std));
select public.set_account_status((select id from t_student), 'restricted');
select test_helpers.as_user((select id from t_student));
select ok(
  (not public.has_live_subscription())
  and not public.can_access_test((select id from t_any))
  and not public.can_access_test((select id from t_free)),
  '12 blocked account overrides subscription and free resources'
);
select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'active');

------------------------------------------------------------------
-- 13 student cannot mutate
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select throws_ok(
  format(
    'insert into public.subscriptions (student_id, plan_id, status, starts_at, ends_at) values (%L, %L, ''active'', now(), now() + interval ''1 day'')',
    (select id from t_other), (select id from t_std)
  ),
  'new row violates row-level security policy for table "subscriptions"',
  '13 student cannot create a subscription row'
);
select lives_ok(
  format(
    'update public.subscriptions set ends_at = now() + interval ''400 days'' where student_id = %L',
    (select id from t_other)
  ),
  'student UPDATE is not rejected with an error (RLS matches zero rows)'
);
select test_helpers.as_runner();
select ok(
  (select ends_at < now() + interval '380 days' from public.subscriptions
    where student_id = (select id from t_other) and status = 'active'),
  '13c student cannot change ends_at'
);

select test_helpers.as_user((select id from t_other));
select is(
  (select count(*)::int from public.subscriptions
    where student_id = (select id from t_student)),
  0,
  '20 tenant/student isolation: cannot read another student''s subscription'
);

------------------------------------------------------------------
-- 18 complimentary subscription
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.deactivate_subscription((
  select id from public.subscriptions
  where student_id = (select id from t_student) and status = 'active'
));
select public.create_subscription_plan('Complimentary', 'comp', 14, true, true, 9)
  as id into temp t_comp;
grant select on t_comp to authenticated;
select public.activate_subscription((select id from t_student), (select id from t_comp))
  as id into temp t_comp_sub;
grant select on t_comp_sub to authenticated;
select test_helpers.as_user((select id from t_student));
select ok(
  public.has_live_subscription()
  and public.can_access_test((select id from t_any)),
  '18 complimentary subscription grants any_subscription access'
);
select test_helpers.as_runner();
select ok(
  (select is_complimentary from public.subscription_plans where id = (select id from t_comp)),
  '18b complimentary is modeled as a plan, not a student flag'
);

------------------------------------------------------------------
-- 19 audit
------------------------------------------------------------------
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.audit_logs
    where action = 'subscription_activated'
      and actor_id = (select id from t_manager)
      and (details ->> 'student_id') = (select id from t_student)::text),
  1,
  '19 activate is audited'
);
select is(
  (select count(*)::int from public.audit_logs
    where action = 'subscription_extended'
      and target_id = (select id from t_live)),
  1,
  '19b extend is audited'
);
select is(
  (select count(*)::int from public.audit_logs
    where action = 'subscription_deactivated'
      and actor_id = (select id from t_manager)),
  1,
  '19c deactivate is audited'
);

select test_helpers.as_user((select id from t_other));
select throws_ok(
  'select public.log_audit(''forged_sub'', ''subscription'', gen_random_uuid(), ''{}''::jsonb)',
  'admin only',
  '19d student cannot forge audit rows'
);

------------------------------------------------------------------
-- search_path
------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'expire_due_subscriptions',
        'create_subscription_plan', 'update_subscription_plan',
        'activate_subscription', 'extend_subscription',
        'set_subscription_end', 'deactivate_subscription',
        'restore_subscription', 'assign_subscription_plan'
      )
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%public%'
      )
  ),
  9,
  'new subscription SECURITY DEFINER functions set search_path = public'
);

select * from finish();
rollback;
