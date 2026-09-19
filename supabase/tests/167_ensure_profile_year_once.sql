-- Check 4 F2: ensure_profile must not re-assign year after any prior enrollment.
begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();

-- Second seeded year for self-assignment attempt after first enrollment ends
select id as year_id into temp t_alt_year
from public.years
where year_number = 2
limit 1;

select gen_random_uuid() as id into temp t_student;
grant select on curriculum, t_student, t_alt_year to anon, authenticated;

------------------------------------------------------------------
-- First provision still creates active enrollment from year_id
------------------------------------------------------------------
select test_helpers.as_user(
  (select id from t_student),
  null,
  (select id from t_student) || '@f2.invalid',
  jsonb_build_object(
    'full_name', 'F2 First',
    'year_id', (select year_id from curriculum)
  )
);
select lives_ok('select public.ensure_profile()', 'first provision ensure_profile succeeds');
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.enrollments where student_id = (select id from t_student)),
  1,
  'first provision creates one enrollment'
);
select is(
  (select year_id from public.enrollments where student_id = (select id from t_student)),
  (select year_id from curriculum),
  'first provision uses JWT year_id'
);

------------------------------------------------------------------
-- After enrollment ends, metadata year_id must not create a new class
------------------------------------------------------------------
select test_helpers.as_runner();
update public.enrollments
set status = 'expired'
where student_id = (select id from t_student);

select test_helpers.as_user(
  (select id from t_student),
  null,
  (select id from t_student) || '@f2.invalid',
  jsonb_build_object(
    'full_name', 'F2 First',
    'year_id', (select year_id from t_alt_year)
  )
);
select lives_ok(
  'select public.ensure_profile()',
  'ensure_profile still succeeds after enrollment ended'
);
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.enrollments
   where student_id = (select id from t_student) and status = 'active'),
  0,
  'ended enrollment cannot self-create a new active year via metadata'
);
select is(
  (select count(*)::int from public.enrollments where student_id = (select id from t_student)),
  1,
  'no additional enrollment row is inserted after first provision'
);

------------------------------------------------------------------
-- Never-enrolled subject with year_id still provisions (true first path)
------------------------------------------------------------------
select gen_random_uuid() as id into temp t_fresh;
grant select on t_fresh to anon, authenticated;
select test_helpers.as_user(
  (select id from t_fresh),
  null,
  (select id from t_fresh) || '@f2fresh.invalid',
  jsonb_build_object(
    'full_name', 'F2 Fresh',
    'year_id', (select year_id from curriculum)
  )
);
select lives_ok('select public.ensure_profile()', 'never-enrolled subject can still self-assign year once');
select test_helpers.as_runner();
select is(
  (select count(*)::int from public.enrollments
   where student_id = (select id from t_fresh) and status = 'active'),
  1,
  'true first provision still creates active enrollment'
);

select * from finish();
rollback;
