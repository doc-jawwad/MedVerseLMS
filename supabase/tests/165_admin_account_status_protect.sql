-- Last active Main Admin cannot be blocked; admin targets need manage_admins.
begin;
select plan(6);

select test_helpers.as_runner();
select test_helpers.make_admin('Protect Main') as id into temp t_main;
select test_helpers.make_limited_admin(
  'Protect Restrict',
  array['restrict_students']
) as id into temp t_restrict;
select test_helpers.make_limited_admin(
  'Protect Limited',
  array['edit_questions']
) as id into temp t_limited;
select test_helpers.make_limited_admin(
  'Protect Second Main Seed',
  array['edit_questions']
) as id into temp t_second;

grant select on t_main, t_restrict, t_limited, t_second to anon, authenticated;

-- Isolate this transaction from any pre-existing Main Admin rows (staging).
select test_helpers.as_runner();
update public.profiles
set is_main_admin = false
where is_main_admin
  and id <> (select id from t_main);

select test_helpers.as_user((select id from t_restrict));
select throws_ok(
  format(
    'select public.set_account_status(%L, %L)',
    (select id from t_limited),
    'restricted'
  ),
  'permission_denied',
  'restrict_students cannot block another admin without manage_admins'
);

select test_helpers.as_user((select id from t_main));
select lives_ok(
  format(
    'select public.set_account_status(%L, %L)',
    (select id from t_limited),
    'restricted'
  ),
  'Main Admin can disable a limited admin'
);

select throws_ok(
  format(
    'select public.set_account_status(%L, %L)',
    (select id from t_main),
    'restricted'
  ),
  'cannot disable the last active Main Admin',
  'last active Main Admin cannot be blocked'
);

select lives_ok(
  format('select public.set_main_admin(%L, true)', (select id from t_second)),
  'second Main Admin can be granted when one already exists'
);

select lives_ok(
  format(
    'select public.set_account_status(%L, %L)',
    (select id from t_main),
    'suspended'
  ),
  'a Main Admin can be blocked when another active Main Admin remains'
);

select lives_ok(
  format(
    'select public.set_account_status(%L, %L)',
    (select id from t_main),
    'active'
  ),
  'blocked Main Admin can be restored'
);

select * from finish();
rollback;
