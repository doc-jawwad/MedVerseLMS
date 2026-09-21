-- Mock tests: test_type column, validate_test relaxation, can_access_test,
-- and list_student_mock_tests RPC.

begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'MT Student') as id
  into temp t_student;
select test_helpers.make_admin('MT Admin') as id into temp t_admin;

grant select on curriculum, t_student, t_admin to anon, authenticated;

-- 1. test_type column defaults to 'formal'
select test_helpers.as_user((select id from t_admin));
create temp table t_formal as
  with ins as (
    insert into public.tests (
      title, year_id, opens_at, closes_at, duration_minutes,
      marks_per_question, negative_mark, min_questions
    ) values (
      'MT Formal Default',
      (select year_id from curriculum),
      now() + interval '1 day', now() + interval '2 days',
      60, 1, 0, 5
    ) returning id
  )
  select id from ins;
grant select on t_formal to anon, authenticated;

select is(
  (select test_type from public.tests where id = (select id from t_formal)),
  'formal',
  '1. test_type defaults to formal'
);

-- 2. can insert mock type
create temp table t_mock as
  with ins as (
    insert into public.tests (
      title, year_id, duration_minutes, marks_per_question, negative_mark, min_questions, test_type
    ) values (
      'MT Mock Test',
      (select year_id from curriculum),
      60, 1, 0, 1, 'mock'
    ) returning id
  )
  select id from ins;
grant select on t_mock to anon, authenticated;

select is(
  (select test_type from public.tests where id = (select id from t_mock)),
  'mock',
  '2. can set test_type = mock'
);

-- 3. invalid test_type raises constraint
select throws_ok(
  $$ insert into public.tests (title, year_id, duration_minutes, marks_per_question, negative_mark, min_questions, test_type)
     values ('Bad', (select year_id from curriculum), 60, 1, 0, 5, 'invalid_type') $$,
  '23514',
  null,
  '3. invalid test_type rejected by check constraint'
);

-- 4. validate_test for mock with no schedule passes the schedule checks
-- First attach a question
select test_helpers.as_user((select id from t_admin));
do $$
declare
  v_q_id uuid;
begin
  select public.create_question(
    p_topic_id => (select topic_id from curriculum),
    p_stem => 'Mock test question stem',
    p_options => '[{"key":"a","text":"opt a"},{"key":"b","text":"opt b"},{"key":"c","text":"opt c"},{"key":"d","text":"opt d"}]'::jsonb,
    p_correct_key => 'a',
    p_explanation => '',
    p_reference => '',
    p_difficulty => 'medium',
    p_tags => '{}',
    p_status => 'approved'
  ) into v_q_id;
  insert into public.test_questions (test_id, question_id, position)
  values ((select id from t_mock), v_q_id, 1);
  insert into public.test_audiences (test_id, year_id)
  values ((select id from t_mock), (select year_id from curriculum));
end;
$$;

select test_helpers.as_user((select id from t_admin));
select public.validate_test((select id from t_mock)) AS column1 into temp t_validate_mock;
grant select on t_validate_mock to anon, authenticated;

-- The schedule check rows should pass = true for mock tests
select ok(
  (select bool_and((v->>'pass')::boolean)
   from jsonb_array_elements((select column1 from t_validate_mock limit 1)) v
   where v->>'check' like '%schedule%'),
  '4. mock validate_test: schedule checks pass even without opens_at'
);

-- 5. list_student_mock_tests returns 0 rows without enrollment
select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.list_student_mock_tests()),
  0,
  '5. no mock tests visible without enrollment + publish'
);

-- 6. student cannot insert into tests
select throws_ok(
  $$ insert into public.tests (title, year_id, duration_minutes, marks_per_question, negative_mark, min_questions, test_type)
     values ('student hack', (select year_id from curriculum), 60, 1, 0, 5, 'mock') $$,
  null,
  null,
  '6. student cannot insert tests (RLS)'
);

-- 7. student UPDATE on tests hits 0 rows (RLS hides the row; same pattern as 010_rls.sql)
select is_empty(
  format($$ update public.tests set test_type = 'formal' where id = %L returning id $$,
    (select id from t_mock)::text),
  '7. student UPDATE on tests hits 0 rows (RLS)'
);

-- 8. test_type is frozen after publish — use admin
select test_helpers.as_user((select id from t_admin));
-- publish the mock test first
select public.publish_test((select id from t_mock));
select throws_ok(
  format($$ update public.tests set test_type = 'formal' where id = %L $$,
    (select id from t_mock)::text),
  'P0001',
  'published test config is frozen (docs/test-rules.md)',
  '8. test_type frozen after publish'
);

-- 9. anon cannot call list_student_mock_tests
select test_helpers.as_anon();
select throws_ok(
  $$ select * from public.list_student_mock_tests() $$,
  null,
  null,
  '9. anon cannot call list_student_mock_tests'
);

-- 10. can_access_test: student with enrollment + mock published can access
select test_helpers.as_user((select id from t_student));
-- enroll student
select test_helpers.as_runner();
insert into public.enrollments (student_id, year_id, status)
values ((select id from t_student), (select year_id from curriculum), 'active')
on conflict do nothing;
select test_helpers.as_user((select id from t_student));
select ok(
  public.can_access_test((select id from t_mock)),
  '10. enrolled student can access published mock test'
);

select * from finish();
rollback;
