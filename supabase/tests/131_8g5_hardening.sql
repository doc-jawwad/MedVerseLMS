-- Focused 8G-5 hardening: payment-instruction account gate + first Main Admin
-- bootstrap. Inserts profiles directly (no auth.users) so the file also runs
-- on VPS staging where auth.users is a stub.

begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

create temp table t_student as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'h-student@test.invalid', 'Hardening Student', 'student', 'active', false)
  returning id
)
select id from ins;
create temp table t_other as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'h-other@test.invalid', 'Hardening Other', 'student', 'active', false)
  returning id
)
select id from ins;
create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'h-admin@test.invalid', 'Hardening Admin', 'admin', 'active', true)
  returning id
)
select id from ins;

insert into public.enrollments (student_id, year_id, status)
values
  ((select id from t_student), (select year_id from curriculum), 'active'),
  ((select id from t_other), (select year_id from curriculum), 'active');

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on curriculum, t_student, t_other, t_admin, t_std to anon, authenticated;

select test_helpers.as_user((select id from t_admin));
select lives_ok(
  $$select public.upsert_payment_settings(
    p_bank_name => 'HBL',
    p_account_title => 'MedVerse',
    p_account_number => '12345',
    p_iban => 'PK00HBL00000000000012345',
    p_payment_instructions => 'Transfer',
    p_qr_reference => 'MV-SUB',
    p_currency => 'PKR',
    p_is_active => true
  )$$,
  'payment settings can be activated for instruction tests'
);

select test_helpers.as_user((select id from t_student));
select is(
  public.get_payment_instructions() ->> 'bank_name',
  'HBL',
  'active student can read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.activate_subscription((select id from t_student), (select id from t_std));
select public.set_account_status((select id from t_student), 'restricted');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  'restricted student cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'suspended');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  'suspended student cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'deactivated');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  'deactivated student cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'revoked');
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.get_payment_instructions()$$,
  'account_not_eligible',
  'revoked student cannot read payment instructions'
);

select test_helpers.as_user((select id from t_admin));
select public.set_account_status((select id from t_student), 'active');
select public.deactivate_subscription((
  select id from public.subscriptions
  where student_id = (select id from t_student) and status = 'active'
  limit 1
));
select test_helpers.as_user((select id from t_student));
select is(
  public.get_payment_instructions() ->> 'bank_name',
  'HBL',
  'active student without a live subscription can still read payment instructions'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.bootstrap_first_main_admin()$$,
  'main_admin_exists',
  'bootstrap refuses while a Main Admin exists'
);

select test_helpers.as_runner();
set local session_replication_role = replica;
update public.profiles set is_main_admin = false where is_main_admin;
set local session_replication_role = origin;
select test_helpers.as_user((select id from t_other));
select lives_ok(
  $$select public.bootstrap_first_main_admin()$$,
  'bootstrap promotes the caller when no Main Admin exists'
);
select is(
  (select role from public.profiles where id = (select id from t_other)),
  'admin',
  'bootstrapped caller is admin'
);
select ok(
  (select is_main_admin from public.profiles where id = (select id from t_other)),
  'bootstrapped caller is Main Admin'
);
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$select public.bootstrap_first_main_admin()$$,
  'main_admin_exists',
  'second caller cannot bootstrap'
);
select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'main_admin_bootstrapped'
      and target_id = (select id from t_other)
  ),
  'bootstrap_first_main_admin writes an audit row'
);
select test_helpers.as_anon();
select throws_ok(
  $$select public.bootstrap_first_main_admin()$$,
  '42501',
  'permission denied for function bootstrap_first_main_admin',
  'anon cannot execute bootstrap_first_main_admin'
);

select * from finish();
rollback;
