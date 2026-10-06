-- practice_subjects catalog/count semantics: status='approved' only;
-- list via can_view_practice_subject. Shape may be correlated or set-based;
-- rows must match the historical correlated baseline.

begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'PS Count Student') as id
  into temp t_student;
select test_helpers.make_student(
  (select id from public.years where year_number = 2),
  'PS Other Year'
) as id into temp t_other;

select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_approved_a;
select test_helpers.make_question((select topic_id from curriculum), 'B') as id
  into temp t_approved_b;
select test_helpers.make_question((select topic_id from curriculum), 'D') as id
  into temp t_deleted_approved;

select test_helpers.as_runner();
create temp table t_draft as
with ins as (
  insert into public.questions (topic_id, status, difficulty, content_hash, stem_normalized)
  values (
    (select topic_id from curriculum),
    'draft',
    'medium',
    'pgtap-ps-draft-' || gen_random_uuid()::text,
    'pgtap draft stem'
  )
  returning id
)
select id from ins;

update public.questions
set deleted_at = now(),
    purge_after = now() + interval '7 days'
where id = (select id from t_deleted_approved)
  and status = 'approved';

insert into public.practice_answers (
  student_id, question_version_id, selected_key, is_correct,
  subject_id, chapter_id, topic_id
)
select
  (select id from t_student),
  q.current_version_id,
  'A',
  true,
  q.subject_id,
  q.chapter_id,
  q.topic_id
from public.questions q
where q.id = (select id from t_approved_a);

insert into public.practice_answers (
  student_id, question_version_id, selected_key, is_correct,
  subject_id, chapter_id, topic_id
)
select
  (select id from t_student),
  q.current_version_id,
  'A',
  false,
  q.subject_id,
  q.chapter_id,
  q.topic_id
from public.questions q
where q.id = (select id from t_approved_b);

-- Snapshot the historical correlated shape with JWT set but RLS bypassed
-- (same privilege as SECURITY DEFINER). Students have no direct questions SELECT.
select test_helpers.as_runner();
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from t_student), 'role', 'authenticated')::text,
  true
) is not null as jwt_ready;

create temp table t_expected_count as
select count(*) as n
from public.questions q
where q.subject_id = (select subject_id from curriculum)
  and q.status = 'approved';

create temp table t_old_rows as
select
  s.id as subject_id,
  s.name as subject_name,
  (select count(*) from public.questions q
    where q.subject_id = s.id and q.status = 'approved') as approved_questions,
  public.has_practice_access(s.id) as granted,
  (select count(*) from public.practice_answers pa
    where pa.student_id = (select auth.uid()) and pa.subject_id = s.id) as answered,
  (select count(*) from public.practice_answers pa
    where pa.student_id = (select auth.uid()) and pa.subject_id = s.id and pa.is_correct) as correct
from public.subjects s
where public.can_view_practice_subject(s.id);

grant select on curriculum, t_student, t_other, t_approved_a, t_approved_b,
  t_draft, t_deleted_approved, t_expected_count, t_old_rows
  to anon, authenticated;

select test_helpers.as_user((select id from t_student));

select ok(
  exists (
    select 1 from public.practice_subjects()
    where subject_id = (select subject_id from curriculum)
  ),
  '1 enrolled subject is listed'
);

select ok(
  not exists (
    select 1 from public.practice_subjects() ps
    join public.subjects s on s.id = ps.subject_id
    where s.year_id = (select id from public.years where year_number = 2)
  ),
  '2 other-year subjects are not listed'
);

select is(
  (
    select approved_questions from public.practice_subjects()
    where subject_id = (select subject_id from curriculum)
  ),
  (select n from t_expected_count),
  '3 approved_questions matches status=approved count (includes soft-deleted approved)'
);

select is(
  (
    select approved_questions from public.practice_subjects()
    where subject_id = (select subject_id from curriculum)
  ),
  3::bigint,
  '4 count is 2 live approved + 1 soft-deleted approved; draft excluded'
);

select is(
  (
    select granted from public.practice_subjects()
    where subject_id = (select subject_id from curriculum)
  ),
  public.has_practice_access((select subject_id from curriculum)),
  '5 granted matches has_practice_access'
);

select is(
  (
    select answered from public.practice_subjects()
    where subject_id = (select subject_id from curriculum)
  ),
  2::bigint,
  '6 answered counts this student''s practice_answers'
);

select is(
  (
    select correct from public.practice_subjects()
    where subject_id = (select subject_id from curriculum)
  ),
  1::bigint,
  '7 correct counts this student''s is_correct answers'
);

-- Full-row equivalence vs the historical correlated scalar shape.
select is(
  (
    select count(*)::int from public.practice_subjects() cur
    full outer join t_old_rows old using (subject_id)
    where (cur.subject_name, cur.approved_questions, cur.granted, cur.answered, cur.correct)
      is distinct from
      (old.subject_name, old.approved_questions, old.granted, old.answered, old.correct)
    or cur.subject_id is null
    or old.subject_id is null
  ),
  0,
  '8 set-based rows match correlated subject/count/grant rows'
);

select * from finish();
rollback;
