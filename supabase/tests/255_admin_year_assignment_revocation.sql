-- Revocation, role reuse and raw-write boundaries, synthetic rows only.
begin;
select plan(20);
create temp table revoke_fixture(label text primary key, id uuid not null default gen_random_uuid());
insert into revoke_fixture(label) values ('main'),('limited'),('student1'),('student3');
grant select on revoke_fixture to authenticated;
create temp table revoke_years as select id,year_number from public.years where year_number in (1,3);
grant select on revoke_years to authenticated;
insert into public.profiles(id,full_name,email,role,is_main_admin)
select id, 'S2 Revocation '||label, 's2-revoke-'||id||'@test.invalid',
  case when label in ('main','limited') then 'admin' else 'student' end,label='main'
from revoke_fixture;
insert into public.enrollments(student_id,year_id,status)
select f.id,y.id,'active' from revoke_fixture f cross join revoke_years y
where (f.label='student1' and y.year_number=1) or (f.label='student3' and y.year_number=3);
insert into public.admin_permissions(admin_id,permission_code)
select id,'view_students' from revoke_fixture where label='limited';

select test_helpers.as_user((select id from revoke_fixture where label='main'));
select lives_ok(format('select public.set_admin_year_assignments(%L,array[%L]::uuid[])',
  (select id from revoke_fixture where label='limited'),(select id from revoke_years where year_number=1)),
  'assign year 1');
select test_helpers.as_user((select id from revoke_fixture where label='limited'));
select ok(public.admin_can_access_year((select id from revoke_years where year_number=1)),'year 1 accessible');
select ok(not public.admin_can_access_year((select id from revoke_years where year_number=3)),'year 3 denied initially');
-- RLS DELETE without a matching policy can silently affect zero rows.
with removed as (
  delete from public.admin_year_assignments where admin_id=(select id from revoke_fixture where label='limited')
  returning admin_id
)
select is((select count(*) from removed),0::bigint,'limited admin cannot delete assignments directly');
select ok(public.admin_can_access_year((select id from revoke_years where year_number=1)),'raw delete leaves authorized assignment unchanged');

select test_helpers.as_user((select id from revoke_fixture where label='main'));
select lives_ok(format('select public.set_admin_year_assignments(%L,array[%L]::uuid[])',
  (select id from revoke_fixture where label='limited'),(select id from revoke_years where year_number=3)),
  'replace year 1 with year 3');
select is((select count(*) from public.admin_year_assignments where admin_id=(select id from revoke_fixture where label='limited')),1::bigint,'only one assignment remains');
select test_helpers.as_user((select id from revoke_fixture where label='limited'));
select ok(not public.admin_can_access_year((select id from revoke_years where year_number=1)),'year 1 revoked immediately');
select ok(public.admin_can_access_year((select id from revoke_years where year_number=3)),'year 3 granted');
select is((select count(*) from public.profiles where id=(select id from revoke_fixture where label='student1')),0::bigint,'raw cross-class profile denied after revoke');
select throws_ok(format('select public.admin_student_profile(%L)',(select id from revoke_fixture where label='student1')),'P0001','year_scope_denied','private projection denied after revoke');
select is((select count(*) from public.admin_student_directory_search('s2-revoke-'||(select id from revoke_fixture where label='student1')||'@test.invalid')),0::bigint,'directory excludes revoked class');

select test_helpers.as_user((select id from revoke_fixture where label='main'));
select lives_ok(format('select public.set_admin_year_assignments(%L,array[]::uuid[])',(select id from revoke_fixture where label='limited')),'clear all classes');
select is((select count(*) from public.admin_year_assignments where admin_id=(select id from revoke_fixture where label='limited')),0::bigint,'empty assignment set really empty');
select public.set_admin_year_assignments((select id from revoke_fixture where label='limited'),array[(select id from revoke_years where year_number=1)]);
select lives_ok(format('select public.set_admin_role(%L,false)',(select id from revoke_fixture where label='limited')),'demote synthetic limited admin');
select is((select count(*) from public.admin_year_assignments where admin_id=(select id from revoke_fixture where label='limited')),0::bigint,'demotion clears classes');
select lives_ok(format('select public.set_admin_role(%L,true)',(select id from revoke_fixture where label='limited')),'reuse identity');
select is((select count(*) from public.admin_year_assignments where admin_id=(select id from revoke_fixture where label='limited')),0::bigint,'repromotion inherits no stale classes');
select test_helpers.as_runner();
select throws_ok(format('insert into public.admin_year_assignments(admin_id,year_id) values (%L,%L)',
  (select id from revoke_fixture where label='limited'),(select id from revoke_years where year_number=1)),
  'P0001','admin_year_assignment_rpc_only','raw writes remain guarded');
select is(has_function_privilege('authenticated','public.clear_admin_years_on_role_change()','execute'),false,'internal trigger not client-callable');
select * from finish();
rollback;
