-- Check 5 Lows: payment discard authorize, drive_url https CHECK, log_audit EXECUTE revoke.
begin;
select plan(13);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'C5 Low Student') as id
  into temp t_student;
select test_helpers.make_limited_admin('C5 Low Reviewer', array['review_subscription_applications']) as id
  into temp t_reviewer;
select test_helpers.make_limited_admin('C5 Low Materials', array['manage_materials']) as id
  into temp t_mats;
select test_helpers.make_limited_admin('C5 Low Pay', array['manage_payment_settings']) as id
  into temp t_pay;
select test_helpers.make_admin('C5 Low Main') as id into temp t_main;

select id as id into temp t_std
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;

grant select on curriculum, t_student, t_reviewer, t_mats, t_pay, t_main, t_std
  to anon, authenticated;

select test_helpers.as_user((select id from t_pay), gen_random_uuid());
select public.upsert_payment_settings(
  p_bank_name => 'C5 Low Bank',
  p_account_title => 'MedVerse',
  p_account_number => '1',
  p_iban => 'PK00C5000000000000000001',
  p_payment_instructions => 'pay',
  p_currency => 'PKR',
  p_is_active => true
);

------------------------------------------------------------------
-- Low 1: discard authorization
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select public.allocate_payment_screenshot_object_key() as orphan_key into temp t_orphan;
grant select on t_orphan to authenticated;

select is(
  public.authorize_payment_screenshot_discard((select orphan_key from t_orphan)),
  (select orphan_key from t_orphan),
  'student can authorize discard of an unattached orphan key'
);

select public.create_subscription_application(
  1500,
  (select orphan_key from t_orphan),
  (select id from t_std)
) as app_id into temp t_app;
grant select on t_app to authenticated;

select throws_ok(
  format(
    'select public.authorize_payment_screenshot_discard(%L)',
    (select orphan_key from t_orphan)
  ),
  'screenshot_discard_denied',
  'student cannot discard a key attached to a pending application'
);

select test_helpers.as_runner();
select set_config('medverse.subscription_application_rpc', '1', true);
update public.subscription_applications
set status = 'approved', reviewed_at = now(), reviewed_by = (select id from t_reviewer)
where id = (select app_id from t_app);
select set_config('medverse.subscription_application_rpc', '', true);

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format(
    'select public.authorize_payment_screenshot_discard(%L)',
    (select orphan_key from t_orphan)
  ),
  'screenshot_discard_denied',
  'student cannot discard a key attached to a non-pending application'
);

select test_helpers.as_user((select id from t_reviewer), gen_random_uuid());
select is(
  public.authorize_payment_screenshot_discard((select orphan_key from t_orphan)),
  (select orphan_key from t_orphan),
  'review admin can authorize discard of an attached application key'
);

select test_helpers.as_user((select id from t_student), gen_random_uuid());
select public.allocate_payment_screenshot_object_key() as orphan2 into temp t_orphan2;
grant select on t_orphan2 to authenticated;
select is(
  public.authorize_payment_screenshot_discard((select orphan2 from t_orphan2)),
  (select orphan2 from t_orphan2),
  'student can still discard a fresh orphan after attach elsewhere'
);

------------------------------------------------------------------
-- Low 2: materials.drive_url https CHECK
------------------------------------------------------------------
select test_helpers.as_runner();
insert into public.material_folders (id, year_id, name, entitlement)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  (select year_id from curriculum),
  'C5 Low Folder',
  'free'
);

select test_helpers.as_user((select id from t_mats), gen_random_uuid());
select lives_ok(
  $$insert into public.materials (folder_id, title, drive_url)
    values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      'C5 valid',
      'https://drive.google.com/file/d/c5-low-ok'
    )$$,
  'manage_materials admin can insert https drive_url'
);

select throws_ok(
  $$insert into public.materials (folder_id, title, drive_url)
    values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      'C5 bad http',
      'http://drive.google.com/file/d/c5-low-bad'
    )$$,
  '23514',
  null,
  'http:// drive_url is rejected at the DB boundary'
);

select throws_ok(
  $$insert into public.materials (folder_id, title, drive_url)
    values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      'C5 bad js',
      'javascript:alert(1)'
    )$$,
  '23514',
  null,
  'javascript: drive_url is rejected at the DB boundary'
);

------------------------------------------------------------------
-- Low 3: log_audit direct EXECUTE revoked; internal path works
------------------------------------------------------------------
select test_helpers.as_user((select id from t_main), gen_random_uuid());
select throws_ok(
  $$select public.log_audit('forged_low', 'profile', gen_random_uuid(), '{}'::jsonb)$$,
  'permission denied for function log_audit',
  'Main Admin cannot call log_audit directly via PostgREST/SQL as authenticated'
);

select test_helpers.as_runner();
select test_helpers.make_published_test(
  (select topic_id from curriculum), (select year_id from curriculum), 1
) as id into temp t_test;
grant select on t_test to authenticated;

select test_helpers.as_user((select id from t_main), gen_random_uuid());
select public.close_test_now((select id from t_test));
select test_helpers.as_runner();
select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'test_closed_now' and target_id = (select id from t_test)
  ),
  'mutation RPC still writes audit_logs via internal log_audit'
);

select ok(
  (
    select prosecdef and proconfig::text like '%search_path=public%'
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'authorize_payment_screenshot_discard'
  ),
  'authorize_payment_screenshot_discard is SECURITY DEFINER with search_path=public'
);

select ok(
  not has_function_privilege('authenticated', 'public.log_audit(text,text,uuid,jsonb)', 'execute'),
  'authenticated lacks EXECUTE on log_audit'
);

select ok(
  not has_function_privilege('anon', 'public.log_audit(text,text,uuid,jsonb)', 'execute'),
  'anon lacks EXECUTE on log_audit'
);

select * from finish();
rollback;
