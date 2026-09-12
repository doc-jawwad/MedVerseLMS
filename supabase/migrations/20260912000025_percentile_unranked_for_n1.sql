-- Product decision (QA finding BUG-008): a test with only one submitted
-- attempt has no comparison group, so percentile is genuinely undefined —
-- neither 0 nor 100 is meaningful. rank_test() previously hard-coded 100.0
-- for n <= 1, which contradicted the literal documented formula (which
-- evaluates to 0 for n=1) without either side explicitly saying so. Decision:
-- show unranked (NULL) instead of picking either number; docs/scoring-rules.md
-- updated to state this explicitly as the canonical exception.
create or replace function public.rank_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  select count(*) into n from public.test_attempts
  where test_id = p_test_id and state = 'submitted';

  with ranked as (
    select id,
      rank() over (order by score desc, submitted_at asc) as r
    from public.test_attempts
    where test_id = p_test_id and state = 'submitted'
  )
  update public.test_attempts a
  set rank = ranked.r,
      percentile = case when n > 1
        then round(100.0 * (n - ranked.r) / (n - 1), 2)
        else null
      end
  from ranked
  where a.id = ranked.id;
end;
$$;
