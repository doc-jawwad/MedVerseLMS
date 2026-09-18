-- Per-student paid_access_mode + grants/restrictions. Profiles inserted
-- directly for VPS staging.

begin;
select plan(11);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_student as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'pag-st@test.invalid', 'PAG Student', 'student', 'active')
  returning id
) select id from ins;
create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'pag-ad@test.invalid', 'PAG Admin', 'admin', 'active', true)
  returning id
) select id from ins;
create temp table t_academic as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'pag-ac@test.invalid', 'PAG Academic', 'admin', 'active', false)
  returning id
) select id from ins;
insert into public.admin_permissions (admin_id, permission_code)
values ((select id from t_academic), 'publish_tests');

insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select year_id from curriculum), 'active');

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

insert into public.tests (
  title, year_id, subject_id, status, opens_at, closes_at, entitlement
) values
  (
    'PAG_cm',
    (select year_id from curriculum),
    (select subject_id from curriculum),
    'published', now() - interval '1 hour', now() + interval '7 days',
    'free'
  ),
  (
    'PAG_other',
    (select year_id from curriculum),
    (select subject_id from curriculum),
    'published', now() - interval '1 hour', now() + interval '7 days',
    'free'
  ),
  (
    'PAG_free',
    (select year_id from curriculum),
    (select subject_id from curriculum),
    'published', now() - interval '1 hour', now() + interval '7 days',
    'free'
  );
insert into public.test_audiences (test_id, year_id)
select id, year_id from public.tests where title like 'PAG_%';
create temp table t_cm as select id from public.tests where title = 'PAG_cm';
create temp table t_other as select id from public.tests where title = 'PAG_other';
create temp table t_free as select id from public.tests where title = 'PAG_free';

create temp table t_sub (id uuid);
grant select on curriculum, t_student, t_admin, t_academic, t_std, t_cm, t_other, t_free, t_sub
  to anon, authenticated;
grant insert on t_sub to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement('test', (select id from t_cm), 'any_subscription');
select public.set_resource_entitlement('test', (select id from t_other), 'any_subscription');
insert into t_sub (id)
select public.activate_subscription(
  (select id from t_student),
  (select id from t_std),
  now(),
  now() + interval '30 days',
  null,
  0,
  'grants_only'
);

select test_helpers.as_user((select id from t_student));
select ok(public.has_live_subscription(), 'subscription is live');
select ok(
  public.can_view_test((select id from t_cm))
  and public.can_view_test((select id from t_other))
  and (not public.can_access_test((select id from t_cm)))
  and (not public.can_access_test((select id from t_other)))
  and public.can_access_test((select id from t_free)),
  'grants_only: paid catalog stays listed/locked; free remains usable'
);

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.grant_access(%L, ''test'', null, %L)',
    (select id from t_student),
    (select id from t_cm)
  ),
  'admin grants Community-Medicine-equivalent paid test'
);
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_cm))
  and (not public.can_access_test((select id from t_other))),
  'explicit grant unlocks only the named paid resource'
);

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.restrict_access(%L, ''test'', null, %L)',
    (select id from t_student),
    (select id from t_cm)
  ),
  'admin can restrict the granted test'
);
select test_helpers.as_user((select id from t_student));
select ok(
  (not public.can_access_test((select id from t_cm))),
  'restriction overrides the grant'
);

select test_helpers.as_user((select id from t_admin));
select public.unrestrict_access((
  select id from public.access_restrictions
  where student_id = (select id from t_student) and revoked_at is null
  limit 1
));
select public.set_account_status((select id from t_student), 'restricted');
select test_helpers.as_user((select id from t_student));
select ok(
  (not public.can_view_test((select id from t_cm)))
  and (not public.can_access_test((select id from t_cm)))
  and (not public.can_access_test((select id from t_free)))
  and (not public.has_live_subscription()),
  'blocked account stays blocked despite grants and free entitlement'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format(
    'select public.grant_access(%L, ''test'', null, %L)',
    (select id from t_student),
    (select id from t_other)
  ),
  'admin only',
  'student cannot grant resources'
);
select throws_ok(
  format(
    'insert into public.access_grants (student_id, grant_type, test_id) values (%L, ''test'', %L)',
    (select id from t_student),
    (select id from t_other)
  ),
  'new row violates row-level security policy for table "access_grants"',
  'direct PostgREST insert cannot grant access'
);

select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'select public.grant_access(%L, ''test'', null, %L)',
    (select id from t_student),
    (select id from t_other)
  ),
  'permission_denied',
  'unauthorized admin cannot grant resources'
);
select throws_ok(
  format(
    'select public.activate_subscription(%L, %L)',
    (select id from t_student),
    (select id from t_std)
  ),
  'permission_denied',
  'unauthorized admin cannot assign subscription dates'
);

select * from finish();
rollback;
