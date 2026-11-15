-- Perf: admin SELECT RLS predicates wrapped in (select ...) must keep exact access:
-- main admin + edit_questions admin see questions/versions; admin without question
-- perms and students do not; questions.year_id equals subjects.year_id (the
-- Prof. Session day page filters questions.year_id instead of joining subjects).
begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_question((select topic_id from curriculum)) as qid into temp t_q;
select test_helpers.make_admin('Initplan Main') as id into temp t_main;
select test_helpers.make_limited_admin('Initplan Editor', array['edit_questions']) as id into temp t_edit;
select test_helpers.make_limited_admin('Initplan NoQ', array['manage_curriculum']) as id into temp t_noq;
select test_helpers.make_student((select year_id from curriculum), 'Initplan Student') as id into temp t_stu;

select is(
  (select q.year_id from public.questions q where q.id = (select qid from t_q)),
  (select s.year_id from public.questions q join public.subjects s on s.id = q.subject_id
   where q.id = (select qid from t_q)),
  'questions.year_id equals subjects.year_id'
);

select test_helpers.as_user((select id from t_main));
select is((select count(*)::int from public.questions where id = (select qid from t_q)), 1, 'main admin sees question');
select is((select count(*)::int from public.question_versions where question_id = (select qid from t_q)), 1, 'main admin sees version');

select test_helpers.as_user((select id from t_edit));
select is((select count(*)::int from public.questions where id = (select qid from t_q)), 1, 'edit_questions admin sees question');

select test_helpers.as_user((select id from t_noq));
select is((select count(*)::int from public.questions where id = (select qid from t_q)), 0, 'admin without question perms sees none');
select is((select count(*)::int from public.subjects where id = (select subject_id from curriculum)), 1, 'any admin still sees subjects');

select test_helpers.as_user((select id from t_stu));
select is((select count(*)::int from public.questions where id = (select qid from t_q)), 0, 'student sees no questions');
select is((select count(*)::int from public.question_versions where question_id = (select qid from t_q)), 0, 'student sees no versions');

select * from finish();
rollback;
