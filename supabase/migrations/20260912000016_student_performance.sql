-- 0016: student dashboard + performance RPCs (Phase 9)
-- All scoped to auth.uid() — a student can only ever see their own numbers.

create or replace function public.student_test_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tests_taken', count(*),
    'average_percentage', round(coalesce(avg(percentage), 0), 2),
    'best_percentage', coalesce(max(percentage), 0),
    'average_rank', round(coalesce(avg(rank), 0), 1)
  )
  from public.test_attempts
  where student_id = (select auth.uid()) and state = 'submitted';
$$;

create or replace function public.student_recent_tests(p_limit int default 5)
returns table (
  test_id uuid,
  title text,
  score numeric,
  max_score numeric,
  percentage numeric,
  rank int,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.test_id, t.title, a.score, a.max_score, a.percentage, a.rank, a.submitted_at
  from public.test_attempts a
  join public.tests t on t.id = a.test_id
  where a.student_id = (select auth.uid()) and a.state = 'submitted'
  order by a.submitted_at desc
  limit greatest(1, least(p_limit, 50));
$$;

-- Chronological trend for a line/bar chart (oldest first).
create or replace function public.student_trend()
returns table (
  test_id uuid,
  title text,
  percentage numeric,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.test_id, t.title, a.percentage, a.submitted_at
  from public.test_attempts a
  join public.tests t on t.id = a.test_id
  where a.student_id = (select auth.uid()) and a.state = 'submitted'
  order by a.submitted_at asc;
$$;

-- Subject performance blends test results and practice accuracy per subject.
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
  select
    s.id,
    s.name,
    round(coalesce(avg(a.percentage), 0), 2),
    count(distinct a.id) filter (where a.id is not null),
    round(coalesce(100.0 * sum((pa.is_correct)::int) / nullif(count(pa.id), 0), 0), 2),
    count(pa.id)
  from public.subjects s
  join public.enrollments e
    on e.year_id = s.year_id and e.student_id = (select auth.uid()) and e.status = 'active'
  left join public.tests t on t.subject_id = s.id
  left join public.test_attempts a
    on a.test_id = t.id and a.student_id = (select auth.uid()) and a.state = 'submitted'
  left join public.practice_answers pa
    on pa.subject_id = s.id and pa.student_id = (select auth.uid())
  group by s.id, s.name, s.sort_order
  order by s.sort_order, s.name;
$$;

-- Weakest chapters by practice accuracy (min 3 attempts to avoid noise), worst first.
create or replace function public.student_weak_chapters(p_limit int default 5)
returns table (
  chapter_id uuid,
  chapter_name text,
  subject_name text,
  accuracy numeric,
  answered bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, s.name,
    round(100.0 * sum((pa.is_correct)::int) / count(pa.id), 2),
    count(pa.id)
  from public.practice_answers pa
  join public.chapters c on c.id = pa.chapter_id
  join public.subjects s on s.id = c.subject_id
  where pa.student_id = (select auth.uid())
  group by c.id, c.name, s.name
  having count(pa.id) >= 3
  order by (sum((pa.is_correct)::int)::numeric / count(pa.id)) asc
  limit greatest(1, least(p_limit, 20));
$$;
