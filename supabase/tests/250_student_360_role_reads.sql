-- Student 360 least-privilege: which reads each admin role can perform (RLS/RPC), synthetic data.
-- Mirrors src/lib/admin/student-360/adapter.ts; a failing row here means the section map is wrong.
begin;
select plan(12);
select test_helpers.as_runner();
select * into temp c from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from c), 'P Stud') as id into temp s;
select test_helpers.make_published_test((select topic_id from c),(select year_id from c),2) as id into temp t;
select test_helpers.make_question((select topic_id from c),'A') as id into temp q;
insert into public.test_attempts (test_id, student_id, state, expires_at, submitted_at, submit_source, device_id, question_order, score, max_score, percentage, raw_correct, raw_wrong, raw_blank)
values ((select id from t),(select id from s),'submitted',now(),now(),'student',gen_random_uuid(),'{}'::uuid[],2,2,100,2,0,0);
insert into public.practice_answers (student_id, question_version_id, selected_key, is_correct, subject_id, chapter_id, topic_id)
select (select id from s), qv.id,'A',true,(select subject_id from c),(select chapter_id from c),(select topic_id from c) from public.question_versions qv where qv.question_id=(select id from q) limit 1;
select id into temp pl from public.subscription_plans where is_complimentary=false order by sort_order limit 1;
insert into public.subscriptions (student_id, plan_id, year_id, status, starts_at, ends_at, grace_days) values ((select id from s),(select id from pl),(select year_id from c),'active',now()-interval '1 day',now()+interval '30 days',0);
select set_config('medverse.subscription_application_rpc','1',true);
insert into public.subscription_applications (student_id, plan_id, amount, currency, screenshot_object_key, status, year_id) values ((select id from s),(select id from pl),1000,'PKR','payment-proofs/x/shot','pending',(select year_id from c));
create or replace function test_helpers.probe360(p uuid) returns jsonb language plpgsql as $$
declare r boolean := true;
begin
  begin perform public.admin_student_profile(p); exception when others then r := false; end;
  return jsonb_build_object(
   'profile',(select count(*) from public.profiles where id=p),
   'enroll',(select count(*) from public.enrollments where student_id=p),
   'attempts',(select count(*) from public.test_attempts where student_id=p and state='submitted'),
   'practice',(select count(*) from public.practice_answers where student_id=p),
   'apps',(select count(*) from public.subscription_applications where student_id=p),
   'subs',(select count(*) from public.subscriptions where student_id=p),
   'rpc', r);
end $$;
grant execute on function test_helpers.probe360(uuid) to authenticated;
select test_helpers.make_admin('M') as id into temp a_main;
select test_helpers.make_limited_admin('v', array['view_students']) as id into temp a_view;
select test_helpers.make_limited_admin('m', array['manage_students']) as id into temp a_man;
select test_helpers.make_limited_admin('r', array['restrict_students']) as id into temp a_restr;
select test_helpers.make_limited_admin('a', array['view_analytics']) as id into temp a_anl;
select test_helpers.make_limited_admin('f', array['manage_subscriptions','review_subscription_applications']) as id into temp a_fin;
select test_helpers.make_limited_admin('rv', array['review_subscription_applications']) as id into temp a_rev;
select test_helpers.make_limited_admin('p', array['manage_payment_settings']) as id into temp a_pay;
select test_helpers.make_limited_admin('n', '{}') as id into temp a_none;
grant select on c, s, a_main, a_view, a_man, a_restr, a_anl, a_fin, a_rev, a_pay, a_none to authenticated;
select test_helpers.as_user((select id from a_main));
select public.set_admin_year_assignments(a, array[(select year_id from c)]) from (select id a from a_view union all select id from a_man union all select id from a_restr union all select id from a_anl union all select id from a_fin union all select id from a_rev union all select id from a_pay union all select id from a_none) x;
select test_helpers.as_runner();
select test_helpers.make_limited_admin('ms', array['manage_subscriptions']) as id into temp a_msub;
select test_helpers.make_limited_admin('gr', array['grant_resource_access']) as id into temp a_grant;
select test_helpers.make_limited_admin('yc', array['manage_year_changes']) as id into temp a_yc;
grant select on a_msub, a_grant, a_yc to authenticated;
select test_helpers.as_user((select id from a_main));
select public.set_admin_year_assignments(a, array[(select year_id from c)]) from (select id a from a_msub union all select id from a_grant union all select id from a_yc) x;
select test_helpers.as_runner();
select test_helpers.as_user((select id from a_view));
select is(test_helpers.probe360((select id from s)), '{"rpc":true,"apps":0,"subs":0,"enroll":1,"profile":1,"attempts":1,"practice":1}'::jsonb, '1 a_view read matrix');
select test_helpers.as_user((select id from a_man));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":0,"profile":1,"attempts":0,"practice":0}'::jsonb, '2 a_man read matrix');
select test_helpers.as_user((select id from a_restr));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":0,"profile":1,"attempts":0,"practice":0}'::jsonb, '3 a_restr read matrix');
select test_helpers.as_user((select id from a_anl));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":0,"profile":0,"attempts":1,"practice":1}'::jsonb, '4 a_anl read matrix');
select test_helpers.as_user((select id from a_fin));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":1,"subs":1,"enroll":1,"profile":1,"attempts":0,"practice":0}'::jsonb, '5 a_fin read matrix');
select test_helpers.as_user((select id from a_rev));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":1,"subs":0,"enroll":0,"profile":1,"attempts":0,"practice":0}'::jsonb, '6 a_rev read matrix');
select test_helpers.as_user((select id from a_msub));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":1,"enroll":1,"profile":1,"attempts":0,"practice":0}'::jsonb, '7 a_msub read matrix');
select test_helpers.as_user((select id from a_grant));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":1,"profile":1,"attempts":0,"practice":0}'::jsonb, '8 a_grant read matrix');
select test_helpers.as_user((select id from a_yc));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":1,"profile":1,"attempts":0,"practice":0}'::jsonb, '9 a_yc read matrix');
select test_helpers.as_user((select id from a_pay));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":0,"profile":0,"attempts":0,"practice":0}'::jsonb, '10 a_pay read matrix');
select test_helpers.as_user((select id from a_none));
select is(test_helpers.probe360((select id from s)), '{"rpc":false,"apps":0,"subs":0,"enroll":0,"profile":0,"attempts":0,"practice":0}'::jsonb, '11 a_none read matrix');
select test_helpers.as_runner();
select test_helpers.make_student((select id from public.years where year_number = 3), 'P Stud Y3') as id into temp s3;
grant select on s3 to authenticated;
select test_helpers.as_user((select id from a_msub));
-- Finance rows ARE year-scoped (subs/apps = 0 for another class). NOTE (pre-existing
-- RLS, not changed here): profiles/enrollments SELECT for manage_subscriptions is not
-- year-scoped, so enroll/profile = 1. Student 360 never exposes biodata for this role.
select is(test_helpers.probe360((select id from s3)),
  '{"rpc":false,"apps":0,"subs":0,"enroll":1,"profile":1,"attempts":0,"practice":0}'::jsonb,
  '12 finance reads are year-scoped; profile/enrollment visibility is pre-existing');
select * from finish();
rollback;
