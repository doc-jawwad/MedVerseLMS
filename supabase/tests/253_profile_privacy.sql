-- Verify the profile privilege boundary independently of app UI section gates.
begin;
select plan(39);
create temp table privacy_fixture(label text primary key, id uuid not null default gen_random_uuid());
insert into privacy_fixture(label) values
  ('self'), ('cross'), ('viewer'), ('finance'), ('main'), ('missing'), ('duplicate');
create temp table privacy_year as select id from public.years where year_number = 1;
grant select on privacy_fixture, privacy_year to authenticated;

insert into public.profiles(id, full_name, email, role, is_main_admin)
select id, 'Privacy ' || label,
  case when label in ('cross','duplicate') then 'duplicate-privacy@test.invalid'
    else label || '-privacy@test.invalid' end,
  case when label in ('viewer','finance','main') then 'admin' else 'student' end,
  label = 'main'
from privacy_fixture where label not in ('self','missing');

insert into public.enrollments(student_id, year_id, status)
select f.id, y.id, 'active'
from privacy_fixture f cross join public.years y
where f.label = 'cross' and y.year_number = 3;

insert into public.admin_permissions(admin_id, permission_code)
select id, case label when 'viewer' then 'view_students' else 'manage_subscriptions' end
from privacy_fixture where label in ('viewer','finance');
select set_config('medverse.admin_year_assignment_rpc','1',true);
insert into public.admin_year_assignments(admin_id, year_id)
select f.id, y.id from privacy_fixture f cross join public.years y
where f.label in ('viewer','finance') and y.year_number = 1;
select set_config('medverse.admin_year_assignment_rpc','',true);

select is(has_function_privilege('anon', 'public.get_own_profile()', 'execute'), false,
  'anonymous callers cannot execute self RPC');
select is(has_function_privilege('authenticated', 'public.get_own_profile()', 'execute'), true,
  'signed-in callers can execute self RPC');
select is(has_function_privilege('service_role', 'public.get_own_profile()', 'execute'), false,
  'self RPC needs no service-role grant');
select test_helpers.as_user(null);
select throws_ok('select * from public.get_own_profile()', 'P0001', 'not_authenticated',
  'authenticated role without UID is rejected');
select test_helpers.as_user((select id from privacy_fixture where label = 'missing'));
select is((select count(*) from public.get_own_profile()), 0::bigint, 'missing profile yields no row');
select test_helpers.as_user((select id from privacy_fixture where label = 'self'), gen_random_uuid(),
  'self-privacy@test.invalid', jsonb_build_object('full_name','Privacy Self','college_name','Signup College',
    'year_id',(select id from privacy_year)));
select lives_ok('select public.ensure_profile()', 'first sign-in provisions profile and enrollment');
select is((select year_id from public.enrollments where student_id = auth.uid()), (select id from privacy_year),
  'first signup creates the intended enrollment');
select is((select to_jsonb(p) from public.get_own_profile() p),
  jsonb_build_object('id', auth.uid(), 'full_name', 'Privacy Self', 'email', 'self-privacy@test.invalid',
    'college_name', 'Signup College', 'avatar_object_key', null),
  'the whole self payload contains only the fixed projection');
select throws_ok('select public.get_own_profile(gen_random_uuid())', '42883', null,
  'self RPC accepts no target selector');
select throws_ok('select * from public.profiles', '42501', null, 'student direct wildcard denied');
select throws_ok('select id from public.profiles where email = ''self-privacy@test.invalid''', '42501', null,
  'private-field predicates are denied');
select throws_ok('update public.profiles set email = ''spoof@test.invalid'' where id = auth.uid()',
  '42501', null, 'a student cannot spoof the promotion selector');
select lives_ok($$select public.update_own_profile('Privacy Edited', 'Edited College')$$, 'profile edit works');
select lives_ok('select public.ensure_profile()', 'repeat sign-in works');
select is((select college_name from public.get_own_profile()), 'Edited College',
  'repeat sign-in preserves the edited college');
select is(public.current_session_id(true), false, 'cleared session is not a replacement');
select public.register_session();
select is(public.current_session_id(true), false, 'matching session is retained');
select is(has_column_privilege('authenticated','public.profiles','active_session_id','select'), false,
  'stored session ID is unavailable on raw REST');
select public.allocate_avatar_object_key();
select is(public.authorize_avatar_object(), (select avatar_object_key from public.get_own_profile()),
  'avatar allocation and owner authorization agree');
select throws_ok(
  format('select public.authorize_avatar_object(%L)', (select id from privacy_fixture where label='cross')),
  'P0001','avatar_forbidden','student cannot authorize another avatar');
select lives_ok('update public.profiles set avatar_object_key = null where id = auth.uid()',
  'owner can remove avatar without private SELECT');
select is((select avatar_object_key from public.get_own_profile()), null::text, 'removal persists');
update public.profiles
set avatar_object_key = 'study-content/avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aabb'
where id = auth.uid();
select throws_ok('select public.authorize_avatar_object()', 'P0001', 'avatar_not_found',
  'an avatar key outside the owner namespace is rejected');
select public.allocate_avatar_object_key();

select test_helpers.as_user((select id from privacy_fixture where label = 'self'));
select is(public.current_session_id(true), false, 'client ignores a missing token session');
select is(public.current_session_id(false), true, 'server treats a missing token session as a replacement');
select test_helpers.as_user((select id from privacy_fixture where label = 'self'), gen_random_uuid());
select is(public.current_session_id(true), true, 'replaced session is detected without returning its ID');
select test_helpers.as_user((select id from privacy_fixture where label = 'viewer'));
select is(public.admin_student_profile((select id from privacy_fixture where label = 'self')) -> 'profile',
  jsonb_build_object('full_name','Privacy Self','email','self-privacy@test.invalid','last_login_at',
    (select null::timestamptz), 'college_name','Edited College','avatar_object_key',null,'account_status','active')
  || jsonb_build_object('last_login_at', now(), 'avatar_object_key',
    public.authorize_avatar_object((select id from privacy_fixture where label = 'self'))),
  'viewer gets exactly the in-class profile projection');
select throws_ok(
  format('select public.authorize_avatar_object(%L)', (select id from privacy_fixture where label = 'cross')),
  'P0001','avatar_forbidden','view_students cannot authorize a cross-class avatar');

select test_helpers.as_user((select id from privacy_fixture where label = 'finance'));
select throws_ok('select full_name from public.profiles order by college_name', '42501', null,
  'finance cannot sort by private data');
select throws_ok(
  format('select public.authorize_avatar_object(%L)', (select id from privacy_fixture where label = 'self')),
  'P0001','avatar_forbidden','finance cannot retrieve an in-class avatar key');
select throws_ok($$select public.set_admin_role('self-privacy@test.invalid'::text)$$,
  'P0001', null, 'finance cannot invoke email promotion');

select test_helpers.as_user((select id from privacy_fixture where label = 'main'));
select is(public.admin_student_profile((select id from privacy_fixture where label = 'cross')) -> 'profile' ->> 'email',
  'duplicate-privacy@test.invalid', 'Main Admin retains cross-class recovery');
select lives_ok(
  format('select public.admin_student_profile(%L)', (select id from privacy_fixture where label='duplicate')),
  'Main Admin can recover a profile without an enrollment');
select throws_ok($$select public.set_admin_role('missing-privacy@test.invalid'::text)$$,
  'P0001','profile not found','missing promotion selector fails closed');
select throws_ok($$select public.set_admin_role('viewer-privacy@test.invalid'::text)$$,
  'P0001','That account is already an admin.','existing admin is not promoted again');
select throws_ok($$select public.set_admin_role('duplicate-privacy@test.invalid'::text)$$,
  'P0001','ambiguous profile email','duplicate promotion fails closed');
select is(public.set_admin_role(' SELF-PRIVACY@TEST.INVALID '::text),
  (select id from privacy_fixture where label = 'self'), 'audited promotion returns only the promoted ID');
select lives_ok(
  format('select public.grant_admin_permission(%L, %L)', (select id from privacy_fixture where label='self'), 'view_students'),
  'Main Admin can assign a permission after promotion');
select is((select count(*) from public.audit_logs
  where action='admin_role_granted' and target_id=(select id from privacy_fixture where label='self')),
  1::bigint, 'existing role mutation still writes its audit event');

select * from finish();
rollback;
