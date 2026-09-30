-- Subscription class-switch invariants: approved year_change_requests keep
-- one live subscription window (starts_at/ends_at) while syncing year_id and
-- enrollment. Paid access stays year-scoped via existing can_access_test /
-- resource_entitlement_allows / has_live_subscription / get_class_lock_state.
-- Transaction-scoped fixtures; no schema or RPC changes.

begin;
select plan(34);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;

select test_helpers.make_student((select id from t_y1), 'SCS Switcher') as id
  into temp t_student;
select test_helpers.make_admin('SCS Admin') as id into temp t_admin;

select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

-- Known live window; store the exact row values after insert for identity checks.
insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
) values (
  (select id from t_student),
  (select id from t_plan),
  'active',
  now() - interval '10 days',
  now() + interval '180 days',
  (select id from t_y1),
  0,
  'all_entitled'
);

select id as id, starts_at as starts_at, ends_at as ends_at
  into temp t_sub
  from public.subscriptions
  where student_id = (select id from t_student);

-- Year-scoped free + any_subscription tests (catalog + content entitlement).
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
from t_subj s;

insert into public.test_audiences (test_id, year_id)
select t.id, t.year_id from public.tests t
where t.title like 'SCS_%';

create temp table t_free as
select id, year_id from public.tests where title like 'SCS_free_%';
create temp table t_paid as
select id, year_id from public.tests where title like 'SCS_paid_%';

grant select on curriculum, t_y1, t_y2, t_student, t_admin, t_plan,
  t_sub, t_subj, t_free, t_paid
  to anon, authenticated;

-- Paid entitlement must go through set_resource_entitlement (trigger-enforced).
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'test', (select id from t_paid where year_id = (select id from t_y1)), 'any_subscription'
);
select public.set_resource_entitlement(
  'test', (select id from t_paid where year_id = (select id from t_y2)), 'any_subscription'
);
select test_helpers.as_runner();

------------------------------------------------------------------
-- Precondition: Class 1 enrolled + live sub window
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.has_active_enrollment((select id from t_y1))
  and public.has_live_subscription()
  and public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))
  and public.can_access_test((select id from t_free where year_id = (select id from t_y1)))
  and (not public.can_view_test((select id from t_paid where year_id = (select id from t_y2)))),
  '0 precondition: Class 1 enrollment + live paid/free access; Class 2 hidden'
);

------------------------------------------------------------------
-- 1) Active subscription → approved Class 1 → Class 2 switch
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
-- 2) Switch back to Class 1 while subscription still active
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
-- 3) Another approved switch preserves one subscription window
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

select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_paid where year_id = (select id from t_y2)))
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))),
  '3h after third switch: current class paid ok; previous class paid denied'
);

------------------------------------------------------------------
-- 4) Expiry returns the student to free switching
------------------------------------------------------------------
select test_helpers.as_runner();
update public.subscriptions
set ends_at = now() - interval '1 hour'
where id = (select id from t_sub);

select test_helpers.as_user((select id from t_student));
select ok(
  not public.has_live_subscription(),
  '4 live-subscription check is false after ends_at expiry'
);
select is(
  public.get_class_lock_state()->>'lock',
  'free',
  '4b class lock becomes free after expiry'
);
select ok(
  (public.get_class_lock_state()->>'can_self_change')::boolean,
  '4c free self-switch remains available'
);
select ok(
  (not public.resource_entitlement_allows('any_subscription', null))
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y2)))),
  '4d paid access unavailable after expiry'
);
select lives_ok(
  format('select public.self_change_class(%L::uuid)', (select id from t_y1)),
  '4e free self_change_class works after expiry'
);
select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_student) and e.status = 'active'),
  (select id from t_y1),
  '4f self-switch moves enrollment to Class 1 without resurrecting paid access'
);
select ok(
  (not public.has_live_subscription())
  and (not public.can_access_test((select id from t_paid where year_id = (select id from t_y1)))),
  '4g Class 1 paid still denied after free self-switch (expired sub)'
);

select * from finish();
rollback;
