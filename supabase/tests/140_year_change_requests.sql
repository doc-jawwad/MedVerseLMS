-- Step 8I year_change_requests. Transaction-scoped fixtures.

begin;
select plan(25);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'YC Student') as id
  into temp t_student;
select test_helpers.make_student((select year_id from curriculum), 'YC Other') as id
  into temp t_other;
select test_helpers.make_admin('YC Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('YC Year Mgr', array['manage_year_changes']) as id
  into temp t_year_mgr;
select test_helpers.make_limited_admin('YC Academic', array['publish_tests']) as id
  into temp t_academic;

select id as id into temp t_year2
  from public.years where year_number = 2;
select id as id into temp t_year3
  from public.years where year_number = 3;

grant select on curriculum, t_student, t_other, t_admin, t_year_mgr, t_academic,
  t_year2, t_year3
  to anon, authenticated;

------------------------------------------------------------------
-- Create request
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_year2),
    'Want year 2'
  ),
  'student can create a year-change request'
);

select is(
  (select status from public.year_change_requests
    where student_id = (select id from t_student) and status = 'pending'),
  'pending',
  'request is pending'
);

select is(
  (select from_year_id from public.year_change_requests
    where student_id = (select id from t_student) and status = 'pending'),
  (select year_id from curriculum),
  'from_year snapshots current enrollment'
);

------------------------------------------------------------------
-- Duplicate pending blocked
------------------------------------------------------------------
select throws_ok(
  format(
    'select public.create_year_change_request(%L::uuid)',
    (select id from t_year3)
  ),
  'P0001',
  'year_change_already_pending',
  'duplicate pending request is blocked'
);

------------------------------------------------------------------
-- Same year blocked
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select throws_ok(
  format(
    'select public.create_year_change_request(%L::uuid)',
    (select year_id from curriculum)
  ),
  'P0001',
  'same_year',
  'requesting current year is blocked'
);

------------------------------------------------------------------
-- Student isolation
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select is(
  (select count(*)::int from public.year_change_requests
    where student_id = (select id from t_student)),
  0,
  'other student cannot select peer year-change requests'
);

select throws_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1)
  ),
  'P0001',
  'admin only',
  'student cannot approve year-change requests'
);

------------------------------------------------------------------
-- Direct writes blocked
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'insert into public.year_change_requests (student_id, from_year_id, to_year_id) values (%L, %L, %L)',
    (select id from t_other),
    (select year_id from curriculum),
    (select id from t_year2)
  ),
  'P0001',
  'year_change_request_rpc_only',
  'direct insert into year_change_requests is blocked'
);

------------------------------------------------------------------
-- Permission denial (no manage_year_changes)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_academic));
select throws_ok(
  format(
    'select public.reject_year_change_request(%L::uuid, %L)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1),
    'nope'
  ),
  'P0001',
  'permission_denied',
  'admin without manage_year_changes cannot reject'
);

select throws_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1)
  ),
  'P0001',
  'permission_denied',
  'admin without manage_year_changes cannot approve'
);

------------------------------------------------------------------
-- Reject + resubmit
------------------------------------------------------------------
select test_helpers.as_user((select id from t_year_mgr));
select lives_ok(
  format(
    'select public.reject_year_change_request(%L::uuid, %L)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1),
    'Incomplete reason'
  ),
  'year manager can reject'
);

select is(
  (select status from public.year_change_requests
    where student_id = (select id from t_student)
    order by created_at desc limit 1),
  'rejected',
  'rejected request is terminal'
);

-- Year manager lacks audit SELECT; assert as runner.
select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'year_change_rejected'
      and target_type = 'year_change_request'
      and actor_id = (select id from t_year_mgr)
  ),
  'reject writes audit_logs'
);

select test_helpers.as_user((select id from t_student));
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid, %L)',
    (select id from t_year3),
    'Resubmit to year 3'
  ),
  'student can resubmit after reject'
);

------------------------------------------------------------------
-- Approve changes enrollment year (exactly one active)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid, %L)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending' limit 1),
    'Approved for year 3'
  ),
  'main admin can approve'
);

select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_student) and e.status = 'active'),
  (select id from t_year3),
  'approve moves active enrollment to requested year'
);

select is(
  (select count(*)::int from public.enrollments
    where student_id = (select id from t_student) and status = 'active'),
  1,
  'exactly one active enrollment after approve'
);

select ok(
  exists (
    select 1 from public.enrollments
    where student_id = (select id from t_student)
      and year_id = (select year_id from curriculum)
      and status = 'expired'
  ),
  'previous enrollment is expired, not deleted'
);

select ok(
  exists (
    select 1 from public.year_change_requests
    where student_id = (select id from t_student)
      and to_year_id = (select id from t_year3)
      and status = 'approved'
  ),
  'request marked approved'
);

select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'year_change_approved'
      and target_type = 'year_change_request'
      and actor_id = (select id from t_admin)
  ),
  'approve writes audit_logs'
);

------------------------------------------------------------------
-- Account status unchanged by year change
------------------------------------------------------------------
select is(
  (select account_status from public.profiles where id = (select id from t_student)),
  'active',
  'year change does not alter account_status'
);

------------------------------------------------------------------
-- Restricted account: approve still moves year, status stays restricted
------------------------------------------------------------------
select test_helpers.as_user((select id from t_other));
select public.create_year_change_request((select id from t_year2), 'before restrict');

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_other), 'restricted');

select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_other) and status = 'pending' limit 1)
  ),
  'approve works while account is restricted (does not unblock)'
);

select is(
  (select account_status from public.profiles where id = (select id from t_other)),
  'restricted',
  'approve does not clear restricted account_status'
);

select is(
  (select e.year_id from public.enrollments e
    where e.student_id = (select id from t_other) and e.status = 'active'),
  (select id from t_year2),
  'restricted student enrollment year still updates on approve'
);

select test_helpers.as_user((select id from t_other));
select throws_ok(
  format(
    'select public.create_year_change_request(%L::uuid)',
    (select id from t_year3)
  ),
  'P0001',
  'account_not_eligible',
  'restricted student cannot create a new year-change request'
);

select * from finish();
rollback;
