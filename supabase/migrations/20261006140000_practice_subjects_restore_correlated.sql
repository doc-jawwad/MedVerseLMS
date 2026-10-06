-- Restore practice_subjects() correlated counts.
-- Staging/prod evidence: the 20261006130000 set-based GROUP BY over all
-- approved questions was slower as a SECURITY DEFINER function than the
-- original per-visible-subject count(*) (≈58ms / 7556 buffers vs ≈34ms /
-- 2393 buffers for a 5-subject student). Counts were equivalent; no
-- performance advantage. Revert query shape. Visibility/content helpers
-- unchanged.

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
    (select count(*) from public.questions q
      where q.subject_id = s.id and q.status = 'approved') as approved_questions,
    public.has_practice_access(s.id) as granted,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id) as answered,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id and pa.is_correct) as correct
  from public.subjects s
  where public.can_view_practice_subject(s.id)
  order by s.sort_order, s.name;
$$;

comment on function public.practice_subjects() is
  'Student MCQ Bank subject catalog. Correlated approved/answer counts; visibility/content flags use can_view_practice_subject / has_practice_access. 20261006130000 set-based rewrite reverted after production timing regression.';
