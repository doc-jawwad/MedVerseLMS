-- GATE: Question Bank / Test Builder year-scoped retrieval index.
-- Evidence: year_id + deleted_at IS NULL (+ optional status) + ORDER BY created_at
-- performed Seq Scans (~8k FY live rows / ~32k table). No year_id index existed.
-- Partial live index matches admin QB list/count and Test Builder pool shapes.
-- Does not change access semantics, RLS, random selection, taxonomy, or app code.

create index if not exists questions_year_live_created_idx
  on public.questions (year_id, created_at desc)
  where deleted_at is null;

comment on index public.questions_year_live_created_idx is
  'Year-scoped live Question Bank / Test Builder list+count (year_id, created_at DESC) WHERE deleted_at IS NULL.';

analyze public.questions;