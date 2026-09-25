-- Career Counseling Series: library_type + universal (not year-scoped) access.
-- Uses profile inserts (not auth.users) so the suite runs on VPS staging stubs.
begin;
select plan(11);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

select id as id into temp t_y1 from public.years where year_number = 1;
select id as id into temp t_y2 from public.years where year_number = 2;
select id as id into temp t_y4 from public.years where year_number = 4;
select id as id into temp t_y5 from public.years where year_number = 5;

create temp table t_y1_free as
with i as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'ccs-y1-free@test.invalid', 'CCS Y1 Free', 'student', 'active')
  returning id
) select id from i;
create temp table t_y2_free as
with i as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'ccs-y2-free@test.invalid', 'CCS Y2 Free', 'student', 'active')
  returning id
) select id from i;
create temp table t_y4_free as
with i as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'ccs-y4-free@test.invalid', 'CCS Y4 Free', 'student', 'active')
  returning id
) select id from i;
create temp table t_y5_sub as
with i as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'ccs-y5-sub@test.invalid', 'CCS Y5 Sub', 'student', 'active')
  returning id
) select id from i;

insert into public.enrollments (student_id, year_id, status) values
  ((select id from t_y1_free), (select id from t_y1), 'active'),
  ((select id from t_y2_free), (select id from t_y2), 'active'),
  ((select id from t_y4_free), (select id from t_y4), 'active'),
  ((select id from t_y5_sub), (select id from t_y5), 'active');

insert into public.subscriptions (
  student_id, plan_id, status, starts_at, ends_at, year_id, grace_days, paid_access_mode
)
select
  (select id from t_y5_sub),
  (select id from public.subscription_plans where is_complimentary = false order by sort_order, name limit 1),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  (select id from t_y5),
  0,
  'all_entitled';

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type, description, entitlement)
    values (
      null,
      'USMLE pathway',
      'career_counseling_series',
      'Session notes',
      'free'
    )$$,
  'career_counseling_series with null year_id is allowed'
);

select id as id into temp t_ccs
from public.material_folders
where name = 'USMLE pathway' and library_type = 'career_counseling_series'
order by created_at desc
limit 1;

select is(
  (select f.description from public.material_folders f where f.id = (select id from t_ccs)),
  'Session notes',
  'career_counseling_series description is stored'
);

select throws_ok(
  $$insert into public.material_folders (year_id, name, library_type)
    values (
      (select year_id from curriculum),
      'Year-scoped CCS',
      'career_counseling_series'
    )$$,
  '23514',
  null,
  'career_counseling_series rejects non-null year_id'
);

select lives_ok(
  $$insert into public.materials (
      folder_id, title, kind, status, file_type,
      r2_object_key, r2_content_type, r2_byte_size
    )
    values (
      (select id from t_ccs),
      'Guide.pdf', 'pdf', 'published', 'pdf',
      'study-content/test/career-guide.pdf', 'application/pdf', 2048
    )$$,
  'PDF on career_counseling_series folder is allowed'
);

select throws_ok(
  $$insert into public.material_folders (year_id, name, library_type)
    values ((select year_id from curriculum), 'Bad', 'career_counselling')$$,
  '23514',
  null,
  'legacy British spelling library_type is rejected'
);

select lives_ok(
  $$insert into public.material_folders (year_id, name, library_type, entitlement)
    values ((select id from t_y1), 'OS counselling', 'other_services', 'free')$$,
  'other_services remains year-scoped (year_id required)'
);

select id as id into temp t_os
from public.material_folders
where name = 'OS counselling' and library_type = 'other_services'
order by created_at desc
limit 1;

grant select on t_y1, t_y2, t_y4, t_y5, t_y1_free, t_y2_free, t_y4_free, t_y5_sub, t_ccs, t_os
  to anon, authenticated;

select test_helpers.as_user((select id from t_y1_free));
select ok(
  public.can_view_material_folder((select id from t_ccs))
  and public.can_access_material_folder((select id from t_ccs)),
  'Y1 free student can view+access universal CCS'
);

select test_helpers.as_user((select id from t_y2_free));
select ok(
  public.can_view_material_folder((select id from t_ccs))
  and public.can_access_material_folder((select id from t_ccs)),
  'Y2 free student can view+access the same CCS folder'
);

select test_helpers.as_user((select id from t_y4_free));
select ok(
  public.can_view_material_folder((select id from t_ccs))
  and public.can_access_material_folder((select id from t_ccs)),
  'Y4 free student can view+access the same CCS folder'
);

select test_helpers.as_user((select id from t_y5_sub));
select ok(
  public.can_view_material_folder((select id from t_ccs))
  and public.can_access_material_folder((select id from t_ccs))
  and public.has_live_subscription(),
  'Y5 subscribed student can view+access the same CCS folder'
);

select test_helpers.as_user((select id from t_y2_free));
select ok(
  not public.can_view_material_folder((select id from t_os)),
  'other_services stays year-scoped — Y2 cannot see Y1 OS folder'
);

select * from finish();
rollback;
