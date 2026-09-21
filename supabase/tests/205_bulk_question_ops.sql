-- bulk_soft_delete_questions: guards, success, and blocked-by-active-test.

begin;
select plan(7);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('BQ Admin') as id into temp t_admin;
select test_helpers.make_limited_admin('BQ Editor', array['edit_questions']) as id
  into temp t_editor;
select test_helpers.make_student((select year_id from curriculum), 'BQ Student') as id
  into temp t_student;

grant select on curriculum, t_admin, t_editor, t_student to anon, authenticated;

-- Create some questions
select test_helpers.as_user((select id from t_admin));
select public.create_question(
  p_topic_id => (select topic_id from curriculum),
  p_stem => 'BQ Q1', p_options => '[{"key":"a","text":"A"},{"key":"b","text":"B"},{"key":"c","text":"C"},{"key":"d","text":"D"}]'::jsonb,
  p_correct_key => 'a', p_explanation => '', p_reference => '',
  p_difficulty => 'easy', p_tags => '{}', p_status => 'approved'
) into temp t_q1;
select public.create_question(
  p_topic_id => (select topic_id from curriculum),
  p_stem => 'BQ Q2', p_options => '[{"key":"a","text":"A"},{"key":"b","text":"B"},{"key":"c","text":"C"},{"key":"d","text":"D"}]'::jsonb,
  p_correct_key => 'b', p_explanation => '', p_reference => '',
  p_difficulty => 'medium', p_tags => '{}', p_status => 'draft'
) into temp t_q2;
grant select on t_q1, t_q2 to anon, authenticated;

-- 1. editor can bulk delete free questions
select test_helpers.as_user((select id from t_editor));
select ok(
  (select (public.bulk_soft_delete_questions(
    array[(select column1 from t_q1 limit 1)::uuid,
          (select column1 from t_q2 limit 1)::uuid]
  ) ->> 'binned')::int = 2),
  '1. bulk_soft_delete_questions bins 2 questions'
);

-- 2. questions are now soft-deleted
select ok(
  (select count(*)::int from public.questions
   where id in ((select column1 from t_q1 limit 1), (select column1 from t_q2 limit 1))
     and deleted_at is not null) = 2,
  '2. deleted_at set on both questions'
);

-- 3. student cannot call bulk_soft_delete_questions
select test_helpers.as_user((select id from t_student));
select throws_ok(
  $$ select public.bulk_soft_delete_questions(array[gen_random_uuid()]) $$,
  'P0001',
  'permission_denied',
  '3. student cannot call bulk_soft_delete_questions'
);

-- 4. anon cannot call bulk_soft_delete_questions
select test_helpers.as_anon();
select throws_ok(
  $$ select public.bulk_soft_delete_questions(array[gen_random_uuid()]) $$,
  null,
  null,
  '4. anon cannot call bulk_soft_delete_questions'
);

-- 5. empty array raises exception
select test_helpers.as_user((select id from t_editor));
select throws_ok(
  $$ select public.bulk_soft_delete_questions('{}') $$,
  'P0001',
  'no ids provided',
  '5. empty array raises exception'
);

-- 6. questions in active test are blocked
-- Create a published test with a new question
select test_helpers.as_user((select id from t_admin));
do $$
declare
  v_q_id uuid;
  v_test_id uuid;
begin
  select public.create_question(
    p_topic_id => (select topic_id from curriculum),
    p_stem => 'BQ Q Active',
    p_options => '[{"key":"a","text":"A"},{"key":"b","text":"B"},{"key":"c","text":"C"},{"key":"d","text":"D"}]'::jsonb,
    p_correct_key => 'a', p_explanation => '', p_reference => '',
    p_difficulty => 'hard', p_tags => '{}', p_status => 'approved'
  ) into v_q_id;

  insert into public.tests (title, year_id, opens_at, closes_at, duration_minutes, marks_per_question, negative_mark, min_questions)
  values ('BQ Active Test', (select year_id from curriculum), now() + interval '1h', now() + interval '2h', 30, 1, 0, 1)
  returning id into v_test_id;

  insert into public.test_questions (test_id, question_id, position) values (v_test_id, v_q_id, 1);
  insert into public.test_audiences (test_id, year_id) values (v_test_id, (select year_id from curriculum));
  perform public.publish_test(v_test_id);

  create temp table t_q_active as select v_q_id as column1;
end;
$$;
grant select on t_q_active to anon, authenticated;

select test_helpers.as_user((select id from t_editor));
select ok(
  (select (public.bulk_soft_delete_questions(
    array[(select column1 from t_q_active limit 1)::uuid]
  ) ->> 'blocked_active_test')::int = 1),
  '6. question in active test is blocked, not binned'
);

-- 7. blocked question is NOT soft-deleted
select ok(
  (select deleted_at is null from public.questions
   where id = (select column1 from t_q_active limit 1)),
  '7. blocked question deleted_at remains null'
);

select * from finish();
rollback;
