-- Year isolation after approved year change. Inserts profiles directly
-- so the file runs on VPS staging (auth.users stub).

begin;
select plan(12);

select test_helpers.as_runner();

select id as id into temp t_y3 from public.years where year_number = 3;
select id as id into temp t_y4 from public.years where year_number = 4;
select id as id into temp t_y2 from public.years where year_number = 2;

create temp table t_student as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status)
  values (gen_random_uuid(), 'yi-student@test.invalid', 'Year Iso', 'student', 'active')
  returning id
) select id from ins;
create temp table t_admin as
with ins as (
  insert into public.profiles (id, email, full_name, role, account_status, is_main_admin)
  values (gen_random_uuid(), 'yi-admin@test.invalid', 'Year Iso Admin', 'admin', 'active', true)
  returning id
) select id from ins;

insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select id from t_y3), 'active');

insert into public.subjects (year_id, name)
values
  ((select id from t_y3), 'YI_Y3_subj'),
  ((select id from t_y4), 'YI_Y4_subj'),
  ((select id from t_y2), 'YI_Y2_subj')
returning id, year_id, name;
-- capture ids
create temp table t_subj as
select id, year_id from public.subjects
where name in ('YI_Y3_subj', 'YI_Y4_subj', 'YI_Y2_subj');

insert into public.material_folders (year_id, name)
select year_id, 'YI_folder_' || year_id::text from t_subj;
create temp table t_fold as
select id, year_id from public.material_folders
where name like 'YI_folder_%';

insert into public.tests (
  title, year_id, subject_id, status, opens_at, closes_at, entitlement
)
select
  'YI_test_' || s.year_id::text,
  s.year_id,
  s.id,
  'published',
  now() - interval '1 hour',
  now() + interval '2 days',
  'free'
from t_subj s;
insert into public.test_audiences (test_id, year_id)
select t.id, t.year_id from public.tests t
where t.title like 'YI_test_%';

create temp table t_test as
select id, year_id from public.tests where title like 'YI_test_%';

grant select on t_y3, t_y4, t_y2, t_student, t_admin, t_subj, t_fold, t_test
  to anon, authenticated;

------------------------------------------------------------------
-- Year 3 student sees only year 3
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select ok(
  public.has_active_enrollment((select id from t_y3))
  and not public.has_active_enrollment((select id from t_y4))
  and not public.has_active_enrollment((select id from t_y2)),
  'year 3 enrollment is the only live class'
);
select ok(
  public.can_view_test((select id from t_test where year_id = (select id from t_y3)))
  and public.can_access_test((select id from t_test where year_id = (select id from t_y3))),
  'year 3 test is catalog+content visible'
);
select ok(
  (not public.can_view_test((select id from t_test where year_id = (select id from t_y4))))
  and (not public.can_access_test((select id from t_test where year_id = (select id from t_y4)))),
  'year 4 test is hidden (direct id denied)'
);
select ok(
  (not public.can_view_test((select id from t_test where year_id = (select id from t_y2))))
  and (not public.can_view_practice_subject((select id from t_subj where year_id = (select id from t_y2))))
  and (not public.can_view_material_folder((select id from t_fold where year_id = (select id from t_y2)))),
  'year 2 resources are inaccessible'
);
select is(
  (select count(*)::int from public.tests where title like 'YI_test_%'),
  1,
  'direct tests SELECT of year-isolation fixtures returns only the current-year row'
);

------------------------------------------------------------------
-- Approve year 3 → 4
------------------------------------------------------------------
select lives_ok(
  format(
    'select public.create_year_change_request(%L::uuid)',
    (select id from t_y4)
  ),
  'student can request year 4'
);
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.approve_year_change_request(%L::uuid)',
    (select id from public.year_change_requests
      where student_id = (select id from t_student) and status = 'pending')
  ),
  'admin approves year change'
);

select test_helpers.as_user((select id from t_student));
select ok(
  public.has_active_enrollment((select id from t_y4))
  and not public.has_active_enrollment((select id from t_y3)),
  'after approval only year 4 enrollment is live'
);
select ok(
  public.can_view_test((select id from t_test where year_id = (select id from t_y4)))
  and public.can_access_test((select id from t_test where year_id = (select id from t_y4)))
  and public.can_view_practice_subject((select id from t_subj where year_id = (select id from t_y4)))
  and public.can_view_material_folder((select id from t_fold where year_id = (select id from t_y4))),
  'year 4 resources become available'
);
select ok(
  (not public.can_view_test((select id from t_test where year_id = (select id from t_y3))))
  and (not public.can_view_practice_subject((select id from t_subj where year_id = (select id from t_y3))))
  and (not public.can_view_material_folder((select id from t_fold where year_id = (select id from t_y3)))),
  'year 3 resources disappear after the change'
);

------------------------------------------------------------------
-- Explicit off-year grant restores previous-year catalog only
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select lives_ok(
  format(
    'select public.grant_access(%L, ''test'', null, %L)',
    (select id from t_student),
    (select id from t_test where year_id = (select id from t_y3))
  ),
  'admin can grant the previous-year test'
);
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_view_test((select id from t_test where year_id = (select id from t_y3)))
  and public.can_access_test((select id from t_test where year_id = (select id from t_y3)))
  and (not public.can_view_practice_subject((select id from t_subj where year_id = (select id from t_y3)))),
  'granted year-3 test is visible; ungranted year-3 practice stays hidden'
);

select * from finish();
rollback;
