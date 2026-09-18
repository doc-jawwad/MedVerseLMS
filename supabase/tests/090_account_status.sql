-- Account status + active class enrollment (Step 8B).
-- Transaction-scoped fixtures, rolled back.

begin;
select plan(38);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Status Student') as id
  into temp t_student;
select test_helpers.make_admin('Status Admin') as id into temp t_admin;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_test;
grant select on curriculum, t_student, t_admin, t_test to anon, authenticated;

select gen_random_uuid() as id into temp t_sess;
grant select on t_sess to authenticated;

------------------------------------------------------------------
-- 1) ensure_profile → active enrollment + default account_status
------------------------------------------------------------------
select gen_random_uuid() as id into temp t_new;
grant select on t_new to anon, authenticated;

select test_helpers.as_user(
  (select id from t_new),
  (select id from t_sess),
  (select id from t_new) || '@ensure.invalid',
  jsonb_build_object(
    'full_name', 'New Verified',
    'year_id', (select year_id from curriculum)
  )
);
select lives_ok('select public.ensure_profile()', 'ensure_profile succeeds for a new JWT subject');
select test_helpers.as_runner();
select is(
  (select account_status from public.profiles where id = (select id from t_new)),
  'active',
  'new profile defaults to account_status=active'
);
select is(
  (select status from public.enrollments where student_id = (select id from t_new)),
  'active',
  'new verified user gets an active class enrollment'
);

------------------------------------------------------------------
-- 2) pending backfill statement (approved mapping)
------------------------------------------------------------------
select test_helpers.make_student((select year_id from curriculum), 'Pending Legacy') as id
  into temp t_pending;
delete from public.enrollments where student_id = (select id from t_pending);
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_pending), (select year_id from curriculum), 'pending');
update public.enrollments set status = 'active' where status = 'pending'
  and student_id = (select id from t_pending);
select is(
  (select status from public.enrollments where student_id = (select id from t_pending)),
  'active',
  'existing pending enrollment is backfilled to active'
);

------------------------------------------------------------------
-- 3–7) account_allows_lms / is_active_session for each status
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select lives_ok('select public.register_session()', 'active student can register a portal session');
select ok(public.account_allows_lms(), 'active account passes LMS account checks');
select ok(public.is_active_session(), 'active account with matching session is an active session');

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'restricted'),
  'admin can set restricted'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select ok((not public.account_allows_lms()), 'restricted account is blocked from LMS');
select ok((not public.is_active_session()), 'restricted account is not an active portal session');

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'active'),
  'admin can restore to active'
);
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'suspended'),
  'admin can set suspended'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select ok((not public.account_allows_lms()), 'suspended account is blocked from LMS');

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'deactivated'),
  'admin can set deactivated'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select ok((not public.account_allows_lms()), 'deactivated account is blocked from LMS');

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'revoked'),
  'admin can set revoked'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select ok((not public.account_allows_lms()), 'revoked account is blocked from LMS');

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'active'),
  'admin can restore a revoked account to active'
);

------------------------------------------------------------------
-- 8–9) blocked account cannot start a new exam (RPC)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select lives_ok('select public.register_session()', 'restored student can register a session again');

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'restricted'),
  'restrict before start_attempt'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select throws_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_test),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'P0001',
  'session_superseded',
  'blocked account cannot start a new exam'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'active'),
  'restore after blocked start_attempt check'
);

------------------------------------------------------------------
-- 10) student cannot change account_status
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select throws_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'revoked'),
  'admin only',
  'student cannot call set_account_status'
);
select throws_ok(
  format(
    'update public.profiles set account_status = %L where id = %L',
    'revoked',
    (select id from t_student)
  ),
  'account_status changes require set_account_status()',
  'student cannot change account_status'
);

------------------------------------------------------------------
-- 11) student cannot change year_id
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess));
update public.enrollments
set year_id = gen_random_uuid()
where student_id = (select id from t_student);
select test_helpers.as_runner();
select is(
  (select e.status from public.enrollments e where e.student_id = (select id from t_student)),
  'active',
  'student RLS leaves the live class enrollment untouched'
);
select is(
  (
    select e.year_id = (select year_id from curriculum)
    from public.enrollments e
    where e.student_id = (select id from t_student)
  ),
  true,
  'student cannot change authoritative year_id'
);

------------------------------------------------------------------
-- 12) existing active enrollments remain valid (status asserted above)
------------------------------------------------------------------

------------------------------------------------------------------
-- 13–14) session cleared on block; disposition required with live attempt
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select lives_ok('select public.register_session()', 'active student can store a portal session before the kick test');
select test_helpers.as_runner();
select isnt(
  (select active_session_id from public.profiles where id = (select id from t_student)),
  null,
  'precondition: portal session is stored'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.set_account_status((select id from t_student), 'suspended');
select test_helpers.as_runner();
select is(
  (select active_session_id from public.profiles where id = (select id from t_student)),
  null,
  'blocking an account clears active_session_id'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'active'),
  'restore before starting an exam for the disposition test'
);
select test_helpers.as_user((select id from t_student), (select id from t_sess));
select lives_ok('select public.register_session()', 'restored student registers a session for the exam');
select lives_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_test),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'active student can start an exam'
);

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select throws_ok(
  format('select public.set_account_status(%L, %L)', (select id from t_student), 'restricted'),
  'attempt_disposition_required',
  'blocking during an in-progress attempt requires an explicit disposition'
);
select lives_ok(
  format(
    'select public.set_account_status(%L, %L, %L)',
    (select id from t_student),
    'restricted',
    'leave_in_progress'
  ),
  'admin can block with leave_in_progress'
);

select test_helpers.as_runner();
select is(
  (select state from public.test_attempts
   where student_id = (select id from t_student) and state = 'in_progress'),
  'in_progress',
  'leave_in_progress does not change the attempt state'
);

select test_helpers.as_user((select id from t_student), (select id from t_sess));
select lives_ok(
  format(
    'select public.start_attempt(%L, %L)',
    (select id from t_test),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'leave_in_progress still allows resume of the live exam via Layer 2'
);

-- Legacy enrollment suspended/revoked are NOT mapped (owner decision).
select test_helpers.make_student((select year_id from curriculum), 'Legacy Suspended') as id
  into temp t_legacy;
delete from public.enrollments where student_id = (select id from t_legacy);
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_legacy), (select year_id from curriculum), 'suspended');
select is(
  (select account_status from public.profiles where id = (select id from t_legacy)),
  'active',
  'legacy suspended enrollment is not auto-mapped onto account_status'
);
select is(
  (select status from public.enrollments where student_id = (select id from t_legacy)),
  'suspended',
  'legacy suspended enrollment row is preserved'
);

select * from finish();
rollback;
