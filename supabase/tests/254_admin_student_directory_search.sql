-- Bounded directory projection: scope, literal matching, ACL and paging.
begin;
select plan(19);
create temp table directory_fixture(label text primary key, id uuid not null default gen_random_uuid());
insert into directory_fixture(label) values ('viewer'),('finance'),('restricted'),('main'),('same'),('cross'),('unassigned'),('blocked');
grant select on directory_fixture to authenticated;
insert into public.profiles(id,full_name,email,role,is_main_admin,account_status)
select id, 'ZQS2Directory '||label, 'zqs2directory-'||label||'@test.invalid',
  case when label in ('viewer','finance','restricted','main') then 'admin' else 'student' end,
  label='main', case when label='blocked' then 'restricted' else 'active' end
from directory_fixture;
insert into public.enrollments(student_id,year_id,status)
select f.id,y.id,'active' from directory_fixture f cross join public.years y
where (f.label in ('same','blocked') and y.year_number=1)
   or (f.label='cross' and y.year_number=3);
insert into public.admin_permissions(admin_id,permission_code)
select id,case label when 'viewer' then 'view_students' when 'finance' then 'manage_subscriptions' else 'restrict_students' end
from directory_fixture where label in ('viewer','finance','restricted');
select set_config('medverse.admin_year_assignment_rpc','1',true);
insert into public.admin_year_assignments(admin_id,year_id)
select f.id,y.id from directory_fixture f cross join public.years y
where f.label in ('viewer','finance','restricted') and y.year_number=1;
select set_config('medverse.admin_year_assignment_rpc','',true);

select is(has_function_privilege('anon','public.admin_student_directory_search(text,text,integer)','execute'),false,'anon denied');
select is(has_function_privilege('service_role','public.admin_student_directory_search(text,text,integer)','execute'),false,'no service role grant');
select test_helpers.as_user((select id from directory_fixture where label='viewer'));
select is((select count(*) from public.admin_student_directory_search('ZQS2DIRECTORY')),2::bigint,'viewer sees only assigned class');
select is((select id from public.admin_student_directory_search('zqs2directory-same@test.invalid')),(select id from directory_fixture where label='same'),'authorized email match');
select is((select count(*) from public.admin_student_directory_search('zqs2directory-cross@test.invalid')),0::bigint,'cross class email search denied');
select is((select count(*) from public.admin_student_directory_search('ZQS2Directory','blocked')),1::bigint,'blocked filter');
select is((select count(*) from public.admin_student_directory_search('ZQS2Directory','',1)),1::bigint,'offset after matching');
select is((select count(*) from public.admin_student_directory_search('ZQS2Directory%')),0::bigint,'percent literal');
select is((select to_jsonb(s) from public.admin_student_directory_search('zqs2directory-same@test.invalid') s),jsonb_build_object('id',(select id from directory_fixture where label='same'),'email','zqs2directory-same@test.invalid'),'exact minimal projection');
select throws_ok('select * from public.admin_student_directory_search('''','''',-1)','P0001','invalid_directory_query','invalid offset rejected');
select test_helpers.as_user((select id from directory_fixture where label='finance'));
select throws_ok('select * from public.admin_student_directory_search()','P0001',null,'finance denied');
select test_helpers.as_user((select id from directory_fixture where label='restricted'));
select throws_ok('select * from public.admin_student_directory_search()','P0001',null,'restricted operator denied private projection');
select test_helpers.as_user((select id from directory_fixture where label='same'));
select throws_ok('select * from public.admin_student_directory_search()','P0001',null,'student denied');
select test_helpers.as_user((select id from directory_fixture where label='main'));
select is((select count(*) from public.admin_student_directory_search('ZQS2Directory')),4::bigint,'Main Admin recovers all student rows including unassigned');
select is(has_column_privilege('authenticated','public.profiles','email','select'),false,'direct email ACL remains closed');
-- Populate a separate synthetic search term past the old 200-row ceiling.
select test_helpers.as_runner();
insert into public.profiles(id,full_name,email,role)
select gen_random_uuid(), 'ZQS2Page '||lpad(i::text,4,'0'),
  'zqs2page-'||lpad(i::text,4,'0')||'@test.invalid','student'
from generate_series(1,205) i;
insert into public.enrollments(student_id,year_id,status)
select p.id,y.id,'active' from public.profiles p cross join public.years y
where p.email like 'zqs2page-%@test.invalid' and y.year_number=1;
select test_helpers.as_user((select id from directory_fixture where label='viewer'));
select is((select count(*) from public.admin_student_directory_search('ZQS2Page')),51::bigint,'bounded first page plus sentinel');
select is((select count(*) from public.admin_student_directory_search('ZQS2Page','',200)),5::bigint,'later page not truncated');
select is((select email from public.admin_student_directory_search('zqs2page-0205@test.invalid')),
  'zqs2page-0205@test.invalid','exact email beyond prior 200-row ceiling found');
select is((select count(*) from public.admin_student_directory_search('ZQS2Page','',205)),0::bigint,'past last page empty');

select * from finish();
rollback;
