-- Fix: student_subject_performance joined two unrelated one-to-many
-- relationships (subject -> tests -> test_attempts, and subject ->
-- practice_answers) in a single query without pre-aggregating either side
-- first. Whenever a subject had more than one test, practice_answers rows
-- were fanned out once per test under that subject, inflating
-- `practice_answered` (and the underlying sum/count feeding
-- `practice_accuracy`, though that ratio happened to cancel out and looked
-- correct by coincidence). QA finding: 5 real practice answers under a
-- subject with 2 tests displayed as "10 answered".
-- Fix: aggregate test performance and practice performance independently in
-- CTEs, then join each 1:1 onto subjects — no fan-out possible.
create or replace function public.student_subject_performance()
returns table (
  subject_id uuid,
  subject_name text,
  test_average_percentage numeric,
  tests_taken bigint,
  practice_accuracy numeric,
  practice_answered bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with test_perf as (
    select t.subject_id,
      round(coalesce(avg(a.percentage), 0), 2) as avg_pct,
      count(distinct a.id) as n_tests
    from public.tests t
    join public.test_attempts a
      on a.test_id = t.id and a.student_id = (select auth.uid()) and a.state = 'submitted'
    group by t.subject_id
  ),
  practice_perf as (
    select pa.subject_id,
      round(coalesce(100.0 * sum((pa.is_correct)::int) / nullif(count(pa.id), 0), 0), 2) as accuracy,
      count(pa.id) as n_answered
    from public.practice_answers pa
    where pa.student_id = (select auth.uid())
    group by pa.subject_id
  )
  select
    s.id,
    s.name,
    coalesce(tp.avg_pct, 0),
    coalesce(tp.n_tests, 0),
    coalesce(pp.accuracy, 0),
    coalesce(pp.n_answered, 0)
  from public.subjects s
  join public.enrollments e
    on e.year_id = s.year_id and e.student_id = (select auth.uid()) and e.status = 'active'
  left join test_perf tp on tp.subject_id = s.id
  left join practice_perf pp on pp.subject_id = s.id
  order by s.sort_order, s.name;
$$;
