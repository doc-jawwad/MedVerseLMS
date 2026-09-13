-- Regression suite for the P1 security-hardening migrations
-- (20260913000002/000003_revoke_*, 20260913000004_log_audit_admin_only).
-- Verifies: admin-only RPCs remain callable by admins, are blocked at the
-- grant level for anon, and still raise their existing 'admin only'
-- business-logic error for a signed-in non-admin student; score_attempt/
-- rank_test (no legitimate direct caller) are blocked for both anon and
-- authenticated; ordinary student exam RPCs (start_attempt/save_answer/
-- submit_attempt) are unaffected; log_audit() now rejects a non-admin
-- caller while still working correctly for a real admin, both called
-- directly and reached internally from another admin RPC. Transaction-
-- scoped fixtures, rolled back — nothing here persists.

begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Sec Student') as id
  into temp t_student;
select test_helpers.make_admin('Sec Admin') as id into temp t_admin;
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_test;
-- separate test fixture for the "admin RPC still works" check below, so
-- closing it doesn't interfere with the exam-flow checks that use t_test.
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 2, 60, 0
) as id into temp t_test2;

grant select on curriculum, t_student, t_admin, t_test, t_test2 to anon, authenticated;

------------------------------------------------------------------
-- Group A: admin-only RPC (promote_student) — grant-level for anon,
-- existing is_admin() business check for a signed-in non-admin, success
-- for a real admin.
------------------------------------------------------------------
select test_helpers.as_anon();
select throws_ok(
  format('select public.promote_student(%L)', (select id from t_student)),
  'permission denied for function promote_student',
  'anon is blocked at the grant level from promote_student (P1-3 REVOKE)'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.promote_student(%L)', (select id from t_student)),
  'admin only',
  'a signed-in non-admin student still hits the existing is_admin() check (unchanged business logic)'
);

-- t_test/t_test2 are already published (test_helpers.make_published_test
-- publishes as part of fixture setup), so exercise a different admin-only
-- RPC that operates on an already-published test rather than re-publishing.
-- Uses t_test2, kept separate from t_test, so closing it doesn't affect the
-- exam-flow checks against t_test further below.
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format('select public.close_test_now(%L)', (select id from t_test2)),
  'a real admin can still call an admin-only RPC after the grant hardening'
);

------------------------------------------------------------------
-- log_audit() (20260913000004): must now reject a non-admin caller,
-- while still working correctly end-to-end for a real admin — both
-- called directly and reached internally from an admin RPC.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.log_audit(''forged_action'', ''test'', %L, ''{}''::jsonb)', (select id from t_test)),
  'admin only',
  'an authenticated non-admin student can no longer call log_audit() directly (the fixed gap)'
);

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format('select public.log_audit(''manual_admin_action'', ''test'', %L, ''{"note":"direct call"}''::jsonb)', (select id from t_test)),
  'a real admin can still call log_audit() directly'
);

select test_helpers.as_runner();
select is(
  (select actor_id from public.audit_logs
   where action = 'manual_admin_action' and target_id = (select id from t_test)),
  (select id from t_admin),
  'the audit row from that direct admin call has the correct actor_id (existing INSERT behavior preserved)'
);
select is(
  (select details from public.audit_logs
   where action = 'manual_admin_action' and target_id = (select id from t_test)),
  '{"note":"direct call"}'::jsonb,
  'the audit row from that direct admin call has the correct details payload'
);

-- close_test_now (Group A, above) is itself is_admin()-gated and calls
-- log_audit() internally — confirm that internal call still completed
-- (i.e. a real admin RPC caller that reaches log_audit() end-to-end is
-- unaffected by adding the guard inside log_audit() itself).
select is(
  (select count(*)::int from public.audit_logs
   where action = 'test_closed_now' and target_id = (select id from t_test2)),
  1,
  'an admin-only RPC (close_test_now) that internally calls log_audit() still produces an audit row end-to-end'
);

------------------------------------------------------------------
-- Group B: score_attempt / rank_test — no legitimate direct caller at
-- all, so both anon and authenticated (including a real admin) are
-- blocked at the grant level; only internal calls from other
-- SECURITY DEFINER functions (submit_attempt, etc.) can still reach them.
------------------------------------------------------------------
select test_helpers.as_anon();
select throws_ok(
  format('select public.rank_test(%L)', (select id from t_test)),
  'permission denied for function rank_test',
  'anon cannot call rank_test directly'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.score_attempt(gen_random_uuid())'),
  'permission denied for function score_attempt',
  'an authenticated student cannot call score_attempt directly'
);

select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format('select public.rank_test(%L)', (select id from t_test)),
  'permission denied for function rank_test',
  'even an authenticated admin cannot call rank_test directly (it has no legitimate direct caller)'
);

------------------------------------------------------------------
-- Ordinary student exam RPCs must be completely unaffected by the
-- grant changes above.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select lives_ok(
  format('select public.start_attempt(%L, gen_random_uuid())', (select id from t_test)),
  'start_attempt is unaffected by the security hardening'
);

select id as attempt_id into temp t_attempt
from public.test_attempts
where test_id = (select id from t_test) and student_id = (select id from t_student);
grant select on t_attempt to anon, authenticated;

select lives_ok(
  format(
    'select public.save_answer(%L, (select question_order[1] from public.test_attempts where id = %L), ''A'', false, 1, (select device_id from public.test_attempts where id = %L))',
    (select attempt_id from t_attempt), (select attempt_id from t_attempt), (select attempt_id from t_attempt)
  ),
  'save_answer is unaffected by the security hardening'
);

select lives_ok(
  format(
    'select public.submit_attempt(%L, (select device_id from public.test_attempts where id = %L))',
    (select attempt_id from t_attempt), (select attempt_id from t_attempt)
  ),
  'submit_attempt (which internally reaches score_attempt/rank_test) still works end-to-end for a real student'
);

select * from finish();
rollback;
