-- Future-test year integrity guards. Run ONLY on disposable PostgreSQL.
-- All synthetic fixtures and temporary trigger toggles roll back.
begin;
select plan(6);

select test_helpers.as_runner();
select * into temp t_year1 from test_helpers.make_curriculum();
select id as year_id into temp t_year2
  from public.years where year_number = 2 limit 1;

with added as (
  insert into public.subjects (year_id, name)
  select year_id, 'PGTAP year guard ' || gen_random_uuid()::text from t_year2
  returning id
) select id as subject_id into temp t_subject2 from added;

with added as (
  insert into public.books (subject_id, name)
  select subject_id, 'PGTAP year guard book' from t_subject2 returning id
) select id as book_id into temp t_book2 from added;

with added as (
  insert into public.chapters (book_id, name)
  select book_id, 'PGTAP year guard chapter' from t_book2 returning id
) select id as chapter_id into temp t_chapter2 from added;

with added as (
  insert into public.topics (chapter_id, name)
  select chapter_id, 'PGTAP year guard topic' from t_chapter2 returning id
) select id as topic_id into temp t_topic2 from added;

select test_helpers.make_question((select topic_id from t_year1))
  as id into temp t_question1;
select test_helpers.make_question((select topic_id from t_topic2))
  as id into temp t_question2;

-- Same year, deliberately DIFFERENT subject: departmental question taxonomy
-- may legitimately differ from the test's product/authoring subject.
with added as (
  insert into public.subjects (year_id, name)
  select year_id, 'PGTAP other subject ' || gen_random_uuid()::text
  from t_year1 returning id
) select id as subject_id into temp t_exam_subject from added;

with added as (
  insert into public.tests (
    title, year_id, subject_id, status, opens_at, closes_at,
    duration_minutes, negative_mark, min_questions
  )
  select
    'PGTAP year integrity', year_id,
    (select subject_id from t_exam_subject), 'draft',
    now() - interval '1 minute', now() + interval '2 hours',
    60, 0, 1
  from t_year1 returning id
) select id into temp t_exam from added;

insert into public.test_audiences (test_id, year_id)
select (select id from t_exam), (select year_id from t_year1);

select lives_ok(
  format('insert into public.test_questions(test_id,question_id,position)
          values (%L,%L,1)',
    (select id from t_exam), (select id from t_question1)),
  'same-year draft question can be assigned'
);

select throws_ok(
  format('insert into public.test_questions(test_id,question_id,position)
          values (%L,%L,2)',
    (select id from t_exam), (select id from t_question2)),
  '23514', 'test_question_year_mismatch',
  'wrong-year question insert is rejected'
);

select throws_ok(
  format('update public.test_questions set question_id=%L
          where test_id=%L and position=1',
    (select id from t_question2), (select id from t_exam)),
  '23514', 'test_question_year_mismatch',
  'wrong-year question reassignment is rejected'
);

-- Simulate a historical wrong-year draft link inserted before the guard.
-- Isolated test database only; DDL and data changes are transaction-scoped.
alter table public.test_questions
  disable trigger test_questions_enforce_year_on_link;
insert into public.test_questions(test_id,question_id,position)
select (select id from t_exam), (select id from t_question2), 2;
alter table public.test_questions
  enable trigger test_questions_enforce_year_on_link;

select test_helpers.make_admin('PGTAP year guard admin')
  as id into temp t_admin;
grant select on t_exam, t_admin to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());

select throws_ok(
  format('select public.publish_test(%L)', (select id from t_exam)),
  '23514', 'test_question_year_mismatch',
  'legacy wrong-year draft fails publication without changing history'
);
select test_helpers.as_runner();

select is(
  (select status from public.tests where id = (select id from t_exam)),
  'draft', 'failed publication leaves test in draft'
);
select is(
  (select count(*)::integer from public.test_questions
   where test_id = (select id from t_exam)
     and question_version_id is not null),
  0, 'failed publication rolls back all frozen question snapshots'
);

select * from finish();
rollback;
