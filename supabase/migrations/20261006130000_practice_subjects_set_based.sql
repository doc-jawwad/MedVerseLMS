-- GATE: MCQ Bank practice_subjects correlated-count optimization.
-- Preserve subject list, counts, status filter, and catalog/content access
-- helpers exactly. Replace per-subject scalar count(*) with one set-based
-- aggregation. Does not change ranking, Test Builder, Question Bank admin,
-- import, Content Bin, Auth, subscriptions, Academic/Notes, or Question Editor.
-- Intentionally does not add deleted_at to the question count: the current
-- RPC counts status='approved' only.

create or replace function public.practice_subjects()
returns table (
  subject_id uuid,
  subject_name text,
  approved_questions bigint,
  granted boolean,
  answered bigint,
  correct bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    coalesce(qc.cnt, 0),
    public.has_practice_access(s.id),
    coalesce(ac.answered, 0),
    coalesce(ac.correct, 0)
  from public.subjects s
  left join (
    select q.subject_id, count(*) as cnt
    from public.questions q
    where q.status = 'approved'
    group by q.subject_id
  ) qc on qc.subject_id = s.id
  left join (
    select
      pa.subject_id,
      count(*) as answered,
      count(*) filter (where pa.is_correct) as correct
    from public.practice_answers pa
    where pa.student_id = (select auth.uid())
    group by pa.subject_id
  ) ac on ac.subject_id = s.id
  where public.can_view_practice_subject(s.id)
  order by s.sort_order, s.name;
$$;

comment on function public.practice_subjects() is
  'Student MCQ Bank subject catalog. Question/answer counts are set-based; visibility/content flags still use can_view_practice_subject / has_practice_access. Approved counts match status=''approved'' only (no deleted_at filter).';
