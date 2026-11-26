-- Run against a candidate schema; every fixture and assertion rolls back.
begin;
select plan(36);
create temp table scope_fixture(k text primary key, id uuid not null default gen_random_uuid());
insert into scope_fixture(k) values ('same'),('cross'),('no_class'),('limited'),('main');
insert into public.profiles(id,full_name,email,role,is_main_admin,account_status)
select id,'E2E scope '||k,'e2e-scope-'||id||'@test.invalid',
  case when k in ('limited','main') then 'admin' else 'student' end,
  k='main','active' from scope_fixture;
insert into public.enrollments(student_id,year_id,status)
select f.id,y.id,'active' from scope_fixture f join public.years y
on y.year_number=case f.k when 'same' then 1 when 'cross' then 3 end;
-- Reverse history: an assigned active Year 1 and a newer unassigned pending Year 3.
insert into public.enrollments(student_id,year_id,status,created_at)
select f.id,y.id,'pending',now()+interval '1 second'
from scope_fixture f cross join public.years y where f.k='same' and y.year_number=3;
insert into public.subjects(year_id,name)
select id,'E2E scope private subject '||gen_random_uuid()::text from public.years where year_number=3;
create temp table scope_private_subjects as
select s.id from public.subjects s join public.years y on y.id=s.year_id where y.year_number=3;
grant select on scope_private_subjects to authenticated;
-- An expired Year-1 enrollment must not make a current Year-3 student readable.
insert into public.enrollments(student_id,year_id,status)
select f.id,y.id,'expired' from scope_fixture f cross join public.years y
where f.k='cross' and y.year_number=1;
insert into public.admin_permissions(admin_id,permission_code)
select id,p from scope_fixture cross join unnest(array['view_students','manage_subscriptions']) p where k='limited';
select set_config('medverse.admin_year_assignment_rpc','1',true);
insert into public.admin_year_assignments(admin_id,year_id)
select f.id,y.id from scope_fixture f cross join public.years y where f.k='limited' and y.year_number=1;
select set_config('medverse.admin_year_assignment_rpc','',true);
grant select on scope_fixture to authenticated;
insert into scope_fixture(k) values ('test');
insert into public.tests(id,title,year_id,status,opens_at,closes_at)
select f.id,'E2E scope read fixture',y.id,'published',now()-interval '1 day',now()+interval '1 day'
from scope_fixture f cross join public.years y where f.k='test' and y.year_number=1;
insert into public.test_attempts(test_id,student_id,state,expires_at,submitted_at,submit_source,device_id,question_order,score,max_score,percentage,raw_correct,raw_wrong,raw_blank)
select t.id,s.id,'submitted',now(),now(),'student',gen_random_uuid(),'{}'::uuid[],1,1,100,1,0,0
from scope_fixture t cross join scope_fixture s where t.k='test' and s.k in ('same','cross');
create temp table scope_question as
select test_helpers.make_question(topic_id) as id from test_helpers.make_curriculum();
insert into public.practice_answers(student_id,question_version_id,selected_key,is_correct,subject_id,chapter_id,topic_id)
select f.id,qv.id,'A',true,q.subject_id,q.chapter_id,q.topic_id
from scope_fixture f cross join scope_question fixture
join public.questions q on q.id=fixture.id
join public.question_versions qv on qv.id=q.current_version_id
where f.k in ('same','cross');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from scope_fixture where k='limited'),'role','authenticated')::text,true);
set local role authenticated;
select ok(public.admin_can_read_student_class((select id from scope_fixture where k='same')),'assigned class positive');
select is(public.admin_can_read_student_class((select id from scope_fixture where k='cross')),false,'cross class denied despite expired assigned class');
select is(public.admin_can_read_student_class((select id from scope_fixture where k='no_class')),false,'no class fails closed for limited admin');
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='same')),1,'same profile retained');
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='cross')),0,'cross profile denied');
select is((select count(*)::int from public.enrollments where student_id=(select id from scope_fixture where k='cross')),0,'cross enrollment history denied');
select is((select count(*)::int from public.enrollments where student_id=(select id from scope_fixture where k='same')),1,'same enrollment retained');
select lives_ok(format('select public.admin_student_profile(%L::uuid)',(select id from scope_fixture where k='same')),'same profile RPC retained');
select is((public.admin_student_profile((select id from scope_fixture where k='same'))->'enrollment'->>'status'),'active','RPC projects current active enrollment rather than newer unassigned record');
select is((public.admin_student_profile((select id from scope_fixture where k='same'))->'enrollment'->>'year_id'),(select id::text from public.years where year_number=1),'RPC returns assigned active year');
select is((select count(*)::int from jsonb_array_elements(public.admin_student_profile((select id from scope_fixture where k='same'))->'subject_access') a join scope_private_subjects s on s.id=(a->>'subject_id')::uuid),0,'RPC does not project unassigned pending class subjects');
select throws_ok(format('select public.admin_student_profile(%L::uuid)',(select id from scope_fixture where k='cross')),'P0001','year_scope_denied','cross RPC denied before Auth fallback');
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='limited')),1,'admin own profile retained');
select is((select count(*)::int from public.test_attempts where student_id=(select id from scope_fixture where k='same')),1,'same attempts retained');
select is((select count(*)::int from public.test_attempts where student_id=(select id from scope_fixture where k='cross')),0,'cross attempts denied');
select is((select count(*)::int from public.practice_answers where student_id=(select id from scope_fixture where k='same')),1,'same practice retained');
select is((select count(*)::int from public.practice_answers where student_id=(select id from scope_fixture where k='cross')),0,'cross practice denied');
reset role;
delete from public.admin_permissions where admin_id=(select id from scope_fixture where k='limited') and permission_code='view_students';
set local role authenticated;
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='cross')),0,'manage_subscriptions alone cross profile denied');
select is((select count(*)::int from public.enrollments where student_id=(select id from scope_fixture where k='cross')),0,'manage_subscriptions alone cross enrollments denied');
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='same')),1,'manage_subscriptions same profile unchanged');
select throws_ok(format('select public.admin_student_profile(%L::uuid)',(select id from scope_fixture where k='same')),'P0001',null,'finance cannot gain biodata RPC');
reset role;
delete from public.admin_permissions where admin_id=(select id from scope_fixture where k='limited');
insert into public.admin_permissions(admin_id,permission_code) select id,'view_analytics' from scope_fixture where k='limited';
set local role authenticated;
select is((select count(*)::int from public.test_attempts where student_id=(select id from scope_fixture where k='same')),1,'analytics same attempts retained');
select is((select count(*)::int from public.test_attempts where student_id=(select id from scope_fixture where k='cross')),0,'analytics cross attempts denied');
select is((select count(*)::int from public.practice_answers where student_id=(select id from scope_fixture where k='same')),1,'analytics same practice retained');
select is((select count(*)::int from public.practice_answers where student_id=(select id from scope_fixture where k='cross')),0,'analytics cross practice denied');
reset role;
delete from public.admin_permissions where admin_id=(select id from scope_fixture where k='limited');
set local role authenticated;
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='same')),0,'class assignment alone grants no profile read');
select is((select count(*)::int from public.enrollments where student_id=(select id from scope_fixture where k='same')),0,'class assignment alone grants no enrollment read');
select is(public.admin_can_read_student_class((select id from scope_fixture where k='same')),false,'class assignment alone grants no helper disclosure');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from scope_fixture where k='main'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='cross')),1,'Main Admin cross profile retained');
select is((select count(*)::int from public.enrollments where student_id=(select id from scope_fixture where k='cross')),2,'Main Admin enrollment history retained');
select lives_ok(format('select public.admin_student_profile(%L::uuid)',(select id from scope_fixture where k='cross')),'Main Admin RPC retained');
select ok(public.admin_can_read_student_class((select id from scope_fixture where k='no_class')),'Main Admin no-class recovery retained');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from scope_fixture where k='cross'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='cross')),1,'student own profile retained');
select is((select count(*)::int from public.enrollments where student_id=(select id from scope_fixture where k='cross')),2,'student own enrollment history retained');
select is((select count(*)::int from public.profiles where id=(select id from scope_fixture where k='same')),0,'student other profile denied');
select is(has_function_privilege('anon','public.admin_can_read_student_class(uuid)','EXECUTE'),false,'anon cannot call new helper');
select * from finish();
rollback;
