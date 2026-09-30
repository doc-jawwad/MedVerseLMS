-- Subscription class-switch invariants: approved year_change_requests keep
-- one live subscription window (starts_at/ends_at) while syncing year_id and
-- plan_id to the destination class. Paid access stays year-scoped via
-- can_access_test / resource_entitlement_allows / has_live_subscription /
-- get_class_lock_state. Transaction-scoped fixtures.

begin;
select plan(62);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;

select test_helpers.make_student((select id from t_y1), 'SCS Switcher') as id
  into temp t_student;
select test_helpers.make_student((select id from t_y1), 'SCS Pref') as id
  into temp t_pref_student;
select test_helpers.make_student((select id from t_y1), 'SCS Fail') as id
  into temp t_fail_student;
select test_helpers.make_student((select id from t_y1), 'SCS Promote') as id
  into temp t_promote_student;
select test_helpers.make_admin('SCS Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('SCS Sub Mgr', array['manage_subscriptions']) as id
  into temp t_sub_mgr;

grant select on curriculum, t_y1, t_y2, t_student, t_pref_student, t_fail_student,
  t_promote_student, t_admin, t_sub_mgr
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_admin_year_assignments(
  (select id from t_sub_mgr),
  array[(select id from t_y1), (select id from t_y2)]
);
select test_helpers.as_runner();

-- Destination / source class plans (deterministic preference coverage).
insert into public.subscription_plans (
  name, description, duration_days, is_complimentary, is_active, sort_order, year_id, price
) values
  ('SCS Y1 Paid', 'y1 paid', 365, false, true, 10, (select id from t_y1), 600),
  ('SCS Y1 Comp', 'y1 comp', 365, true, true, 20, (select id from t_y1), 0),
  ('SCS Y2 Comp Late', 'y2 comp high sort', 365, true, true, 50, (select id from t_y2), 0),
  ('SCS Y2 Comp Early', 'y2 comp preferred', 365, true, true, 5, (select id from t_y2), 0),
  ('SCS Y2 Paid Mid', 'y2 paid', 365, false, true, 10, (select id from t_y2), 600),
  ('SCS Y2 Paid Alpha', 'y2 paid alpha name', 365, false, true, 10, (select id from t_y2), 600);

-- Keep fixture plans deterministic: deactivate other active plans on Y1/Y2.
update public.subscription_plans
set is_active = false
where year_id in ((select id from t_y1), (select id from t_y2))
  and name not like 'SCS %';

select id as id into temp t_plan_y1_paid
  from public.subscription_plans where name = 'SCS Y1 Paid';
select id as id into temp t_plan_y1_comp
  from public.subscription_plans where name = 'SCS Y1 Comp';
select id as id into temp t_plan_y2_comp_early
  from public.subscription_plans where name = 'SCS Y2 Comp Early';
select id as id into temp t_plan_y2_paid_alpha
  from public.subscription_plans where name = 'SCS Y2 Paid Alpha';
select id as id into temp t_plan_y2_paid_mid
  from public.subscription_plans where name = 'SCS Y2 Paid Mid';

-- Main switcher starts on Y1 paid.
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_student),
  (select id from t_plan_y1_paid),
  'active',
  now() - interval '10 days',
  now() + interval '180 days',
  (select id from t_y1),
  0,
  'all_entitled'
);

select id as id, starts_at as starts_at, ends_at as ends_at, plan_id as plan_id
  into temp t_sub
  from public.subscriptions
  where student_id = (select id from t_student);

-- Preference student: complimentary Y1 → should pick Y2 Comp Early (sort 5).
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_pref_student),
  (select id from t_plan_y1_comp),
  'active',
  now() - interval '2 days',
  now() + interval '60 days',
  (select id from t_y1),
  0,
  'all_entitled'
);

-- Fail student: paid Y1; destination year 3 will have no active plans.
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_fail_student),
  (select id from t_plan_y1_paid),
  'active',
  now() - interval '2 days',
  now() + interval '60 days',
  (select id from t_y1),
  0,
  'all_entitled'
);

-- Promote student: paid Y1 live sub.
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_promote_student),
  (select id from t_plan_y1_paid),
  'active',
  now() - interval '5 days',
  now() + interval '90 days',
  (select id from t_y1),
  0,
  'all_entitled'
);

select id as id, starts_at as starts_at, ends_at as ends_at
  into temp t_promote_sub
  from public.subscriptions
  where student_id = (select id from t_promote_student);

-- Ensure year 3 has no active plans for the fail case (deactivate any seeded ones).
update public.subscription_plans
set is_active = false
where year_id = (select id from public.years where year_number = 3);

-- Year-scoped free + any_subscription tests.
insert into public.subjects (year_id, name)
values
  ((select id from t_y1), 'SCS_Y1_subj'),
  ((select id from t_y2), 'SCS_Y2_subj');
create temp table t_subj as
select id, year_id from public.subjects
where name in ('SCS_Y1_subj', 'SCS_Y2_subj');

insert into public.tests (
  title, year_id, subject_id, status, opens_at, closes_at, entitlement
)
select
  'SCS_free_' || s.year_id::text,
  s.year_id,
  s.id,
  'published',
  now() - interval '1 hour',
  now() + interval '2 days',
  'free'
from t_subj s
union all
select
  'SCS_paid_' || s.year_id::text,
  s.year_id,
  s.id,
  'published',
  now() - interval '1 hour',
  now() + interval '2 days',
  'free'
from t_subj s
union all
select
  'SCS_plan_' || s.year_id::text,
  s.year_id,
  s.id,
  'published',
  now() - interval '1 hour',
  now() + interval '2 days',
  'free'
from t_subj s;

insert into public.test_audiences (test_id, year_id)
select t.id, t.year_id from public.tests t
where t.title like 'SCS_%';

create temp table t_free as
select id, year_id from public.tests where title like 'SCS_free_%';
create temp table t_paid as
select id, year_id from public.tests where title like 'SCS_paid_%';
create temp table t_plan_res as
select id, year_id from public.tests where title like 'SCS_plan_%';

grant select on curriculum, t_y1, t_y2, t_student, t_pref_student, t_fail_student,
  t_promote_student, t_admin, t_sub_mgr, t_plan_y1_paid, t_plan_y1_comp,
  t_plan_y2_comp_early, t_plan_y2_paid_alpha, t_plan_y2_paid_mid,
  t_sub, t_promote_sub, t_subj, t_free, t_paid, t_plan_res
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'test', (select id from t_paid where year_id = (select id from t_y1)), 'any_subscription'
);
select public.set_resource_entitlement(
  'test', (select id from t_paid where year_id = (select id from t_y2)), 'any_subscription'
);
-- Plan-specific resources for exact has_live_plan semantics.
select public.set_resource_entitlement(
  'test',
  (select id from t_plan_res where year_id = (select id from t_y1)),
  'plan',
  (select id from t_plan_y1_paid)
);
select public.set_resource_entitlement(
  'test',
  (select id from t_plan_res where year_id = (select id from t_y2)),
  'plan',
  (select id from t_plan_y2_paid_alpha)
);
select test_helpers.as_runner();

------------------------------------------------------------------
-- Precondition
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.has_active_enrollment((select id from t_y1))
  and public.has_live_subscription()
  and public.has_live_plan((select id from t_plan_y1_paid))
  and public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))
  and public.can_access_test((select id from t_plan_res where year_id = (select id from t_y1)))
  and (not public.can_view_test((select id from t_paid where year_id = (select id from t_y2)))),
  '0 precondition: Class 1 enrollment + live paid/plan access; Class 2 hidden'
);

------------------------------------------------------------------
-- 1) Class 1 → Class 2: year + plan remap; window unchanged
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_y2),
    'SCS switch to Class 2'
  ),
  '1 create year-change request Class 1 → Class 2'
);

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1)
  ),
  '1b admin approves Class 2 switch'
);

select test_helpers.as_runner();
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_student) and e.status = 'active'),
  (select id from t_y2),
  '1c enrollment becomes Class 2'
);
select is(
  (select year_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_y2),
  '1d subscriptions.year_id becomes Class 2'
);
select is(
  (select plan_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_plan_y2_paid_alpha),
  '1d2 plan remaps to Y2 paid Alpha (same complimentary=false; sort_order then name)'
);
select is(
  (select sp.year_id from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    where s.id = (select id from t_sub)),
  (select id from t_y2),
  '1d3 plan.year_id matches subscriptions.year_id'
);
select is(
  (select starts_at from public.subscriptions where id = (select id from t_sub)),
  (select starts_at from t_sub),
  '1e subscriptions.starts_at unchanged after Class 2 switch'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_sub)),
  (select ends_at from t_sub),
  '1f subscriptions.ends_at unchanged after Class 2 switch'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.has_live_subscription(),
  '1g subscription remains live after Class 2 switch'
);
select ok(
  public.resource_entitlement_allows('any_subscription', null)
  and public.can_access_test((select id from t_paid where year_id = (select id from t_y2))),
  '1h Class 2 paid access allowed via any_subscription path'
);
select ok(
  public.has_live_plan((select id from t_plan_y2_paid_alpha))
  and public.can_access_test((select id from t_plan_res where year_id = (select id from t_y2))),
  '1h2 has_live_plan exact-match grants destination plan entitlement'
);
select ok(
  (not public.has_live_plan((select id from t_plan_y1_paid)))
  and (not public.can_access_test((select id from t_plan_res where year_id = (select id from t_y1)))),
  '1h3 old plan_id no longer satisfies has_live_plan / old-year plan resource'
);
select ok(
  (not public.can_view_test((select id from t_paid where year_id = (select id from t_y1))))
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))),
  '1i Class 1 paid access denied after switch (no cross-class leakage)'
);
select ok(
  public.can_access_test((select id from t_free where year_id = (select id from t_y2)))
  and (not public.can_view_test((select id from t_free where year_id = (select id from t_y1)))),
  '1j free access remains year-scoped (Class 2 free ok; Class 1 free hidden)'
);

------------------------------------------------------------------
-- 2) Switch back: remap again; window unchanged
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_y1),
    'SCS switch back to Class 1'
  ),
  '2 create year-change request Class 2 → Class 1'
);

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1)
  ),
  '2b admin approves Class 1 switch-back'
);

select test_helpers.as_runner();
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_student) and e.status = 'active'),
  (select id from t_y1),
  '2c enrollment follows Class 1'
);
select is(
  (select year_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_y1),
  '2d subscriptions.year_id follows Class 1'
);
select is(
  (select plan_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_plan_y1_paid),
  '2d2 plan remaps back to Y1 paid'
);
select is(
  (select starts_at from public.subscriptions where id = (select id from t_sub)),
  (select starts_at from t_sub),
  '2e original starts_at remains unchanged'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_sub)),
  (select ends_at from t_sub),
  '2f original ends_at remains unchanged'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_paid where year_id = (select id from t_y1))),
  '2g Class 1 paid access allowed after switch-back'
);
select ok(
  (not public.can_view_test((select id from t_paid where year_id = (select id from t_y2))))
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y2)))),
  '2h Class 2 paid access denied after switch-back (no cross-class leakage)'
);

------------------------------------------------------------------
-- 3) Multiple switches: one row; plan always matches year; window intact
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_y2),
    'SCS third switch to Class 2'
  ),
  '3 create third year-change request'
);

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1)
  ),
  '3b admin approves third switch'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.subscriptions
    where student_id = (select id from t_student)),
  1,
  '3c no duplicate subscription is created'
);
select is(
  (select id from public.subscriptions where student_id = (select id from t_student)),
  (select id from t_sub),
  '3d same subscription row is retained'
);
select is(
  (select starts_at from public.subscriptions where id = (select id from t_sub)),
  (select starts_at from t_sub),
  '3e same original starts_at after multiple switches'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_sub)),
  (select ends_at from t_sub),
  '3f same original ends_at after multiple switches'
);
select is(
  (select year_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_y2),
  '3g only current year_id changes (now Class 2)'
);
select is(
  (select plan_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_plan_y2_paid_alpha),
  '3g2 plan again belongs to Class 2'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_paid where year_id = (select id from t_y2)))
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))),
  '3h after third switch: current class paid ok; previous class paid denied'
);

------------------------------------------------------------------
-- 4) Complimentary preference + deterministic ordering
------------------------------------------------------------------
select test_helpers.as_user((select id from t_pref_student));
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_y2),
    'SCS preferred complimentary remap'
  ),
  '4 create complimentary preference switch request'
);
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_pref_student) and status = 'pending' limit 1)
  ),
  '4b approve complimentary preference switch'
);
select test_helpers.as_runner();
select is(
  (select plan_id from public.subscriptions
    where student_id = (select id from t_pref_student) and status = 'active'),
  (select id from t_plan_y2_comp_early),
  '4c complimentary source prefers destination complimentary plan by sort_order then name'
);
select is(
  public.resolve_destination_subscription_plan_id(
    (select id from t_plan_y1_paid),
    (select id from t_y2)
  ),
  (select id from t_plan_y2_paid_alpha),
  '4d paid source resolves to SCS Y2 Paid Alpha (sort_order=10, name Alpha before Mid)'
);

------------------------------------------------------------------
-- 5) No active destination plan → fail; no partial mutation
------------------------------------------------------------------
select test_helpers.as_runner();
select id as id into temp t_y3 from public.years where year_number = 3;
select
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_fail_student) and e.status = 'active') as year_id,
  (select s.plan_id from public.subscriptions s
    where s.student_id = (select id from t_fail_student) and s.status = 'active') as plan_id,
  (select s.year_id from public.subscriptions s
    where s.student_id = (select id from t_fail_student) and s.status = 'active') as sub_year
into temp t_fail_before;

grant select on t_y3, t_fail_before to authenticated;

select test_helpers.as_user((select id from t_fail_student));
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_y3),
    'SCS fail no dest plan'
  ),
  '5 create request to year without active plans'
);
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_fail_student) and status = 'pending' limit 1)
  ),
  'P0001',
  'destination_plan_unavailable',
  '5b approve fails when destination has no active plan'
);
select test_helpers.as_runner();
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_fail_student) and e.status = 'active'),
  (select year_id from t_fail_before),
  '5c enrollment unchanged after failed approve'
);
select is(
  (select s.plan_id from public.subscriptions s
    where s.student_id = (select id from t_fail_student) and s.status = 'active'),
  (select plan_id from t_fail_before),
  '5d plan_id unchanged after failed approve'
);
select is(
  (select s.year_id from public.subscriptions s
    where s.student_id = (select id from t_fail_student) and s.status = 'active'),
  (select sub_year from t_fail_before),
  '5e subscription year_id unchanged after failed approve'
);
select is(
  (select status from public.year_change_requests
    where student_id = (select id from t_fail_student) and status = 'pending'
    order by created_at desc limit 1),
  'pending',
  '5f year-change request remains pending after failed approve'
);

------------------------------------------------------------------
-- 6) assign_subscription_plan same-year ok / cross-year rejected
------------------------------------------------------------------
select test_helpers.as_user((select id from t_sub_mgr));
select lives_ok(
  format(
    'select public.assign_subscription_plan(%L::uuid, %L::uuid)',
    (select id from t_sub),
    (select id from t_plan_y2_paid_mid)
  ),
  '6 same-year assign_subscription_plan allowed'
);
select throws_ok(
  format(
    'select public.assign_subscription_plan(%L::uuid, %L::uuid)',
    (select id from t_sub),
    (select id from t_plan_y1_paid)
  ),
  'P0001',
  'plan_year_mismatch',
  '6b cross-year assign_subscription_plan rejected'
);
select test_helpers.as_runner();
select is(
  (select plan_id from public.subscriptions where id = (select id from t_sub)),
  (select id from t_plan_y2_paid_mid),
  '6c plan remains the same-year assignment after rejected cross-year attempt'
);

------------------------------------------------------------------
-- 7) promote_student applies the same coherence rule
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.promote_student(%L::uuid)',
    (select id from t_promote_student)
  ),
  '7 promote_student with live subscription succeeds when Y2 plans exist'
);
select test_helpers.as_runner();
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_promote_student) and e.status = 'active'),
  (select id from t_y2),
  '7b promote moves enrollment to Class 2'
);
select is(
  (select year_id from public.subscriptions where id = (select id from t_promote_sub)),
  (select id from t_y2),
  '7c promote syncs subscriptions.year_id'
);
select is(
  (select plan_id from public.subscriptions where id = (select id from t_promote_sub)),
  (select id from t_plan_y2_paid_alpha),
  '7d promote remaps plan_id to destination paid plan'
);
select is(
  (select starts_at from public.subscriptions where id = (select id from t_promote_sub)),
  (select starts_at from t_promote_sub),
  '7e promote leaves starts_at unchanged'
);
select is(
  (select ends_at from public.subscriptions where id = (select id from t_promote_sub)),
  (select ends_at from t_promote_sub),
  '7f promote leaves ends_at unchanged'
);

-- Promote fails atomically when destination has no active plan (Y2 → Y3).
select test_helpers.as_runner();
select set_config('medverse.class_change_rpc', '1', true);
update public.enrollments
set status = 'expired'
where student_id = (select id from t_fail_student) and status = 'active';
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_fail_student), (select id from t_y2), 'active');
select set_config('medverse.class_change_rpc', '', true);
update public.subscriptions
set year_id = (select id from t_y2),
    plan_id = (select id from t_plan_y2_paid_mid)
where student_id = (select id from t_fail_student);

select
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_fail_student) and e.status = 'active') as year_id,
  (select s.plan_id from public.subscriptions s
    where s.student_id = (select id from t_fail_student)) as plan_id
into temp t_promote_fail_before;
grant select on t_promote_fail_before to authenticated;

select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.promote_student(%L::uuid)',
    (select id from t_fail_student)
  ),
  'P0001',
  'destination_plan_unavailable',
  '7g promote fails when next year has no active plan'
);
select test_helpers.as_runner();
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_fail_student) and e.status = 'active'),
  (select year_id from t_promote_fail_before),
  '7h enrollment unchanged after failed promote'
);
select is(
  (select s.plan_id from public.subscriptions s
    where s.student_id = (select id from t_fail_student)),
  (select plan_id from t_promote_fail_before),
  '7i plan_id unchanged after failed promote'
);

------------------------------------------------------------------
-- 8) Expiry returns free switching (unchanged product behavior)
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where id = (select id from t_sub);

select test_helpers.as_user((select id from t_student));
select ok(
  not public.has_live_subscription(),
  '8 live-subscription check is false after ends_at expiry'
);
select is(
  public.get_class_lock_state()->>'lock',
  'free',
  '8b class lock becomes free after expiry'
);
select ok(
  (public.get_class_lock_state()->>'can_self_change')::boolean,
  '8c free self-switch remains available'
);
select ok(
  (not public.resource_entitlement_allows('any_subscription', null))
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y2)))),
  '8d paid access unavailable after expiry'
);
select lives_ok(
  format('select public.self_change_class(%L::uuid)', (select id from t_y1)),
  '8e free self_change_class works after expiry'
);
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_student) and e.status = 'active'),
  (select id from t_y1),
  '8f self-switch moves enrollment to Class 1 without resurrecting paid access'
);
select ok(
  (not public.has_live_subscription())
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))),
  '8g Class 1 paid still denied after free self-switch (expired sub)'
);

select * from finish();
rollback;
