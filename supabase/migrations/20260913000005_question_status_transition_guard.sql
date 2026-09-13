-- Question Bank foundation work: the question review-workflow transition
-- graph (draft/review/approved/needs_revision/archived) previously existed
-- only as an `allowedTransitions` map in src/lib/actions/questions.ts,
-- enforced by the Server Action `setQuestionStatus` — never at the database
-- layer. Since `questions_admin_all` RLS is `for all using(is_admin())`
-- (no further restriction), any admin session calling
-- `supabase.from('questions').update({status:...})` directly (bypassing
-- the Server Action) could set any status to any other status with zero
-- validation. Per this project's stated principle ("everything security/
-- correctness-critical is enforced in Postgres... app checks are UX only",
-- AGENTS.md) and the existing precedent of `protect_published_test()` /
-- `protect_published_test_questions()` guarding the test state machine the
-- same way, this migration moves the same enforcement into a trigger.
--
-- This is a direct, unmodified copy of the transition graph already live
-- in `allowedTransitions` (src/lib/actions/questions.ts) — no new states or
-- transitions are introduced (per AGENTS.md's "do not invent alternative
-- states/transitions" rule). Note for future doc reconciliation: this graph
-- is richer than docs/database.md's prose summary ("draft → review →
-- approved → archived; any state may drop to needs_revision") — e.g. it
-- does not actually allow draft/archived -> needs_revision directly, and
-- allows some extra transitions (review -> draft, needs_revision -> review/
-- approved, archived -> draft) the prose doesn't mention. That mismatch
-- predates this migration; it is preserved as-is here (matching the
-- already-shipped app behavor), not resolved in either direction, since
-- resolving it means changing documented behavior and needs its own
-- explicit approval per AGENTS.md's "change the doc first" rule.

create or replace function public.protect_question_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('review', 'approved', 'archived'))
      or (old.status = 'review' and new.status in ('approved', 'needs_revision', 'draft', 'archived'))
      or (old.status = 'approved' and new.status in ('needs_revision', 'archived'))
      or (old.status = 'needs_revision' and new.status in ('review', 'approved', 'archived'))
      or (old.status = 'archived' and new.status in ('draft'))
    ) then
      raise exception 'invalid question status transition: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

create trigger questions_protect_status_transition
  before update of status on public.questions
  for each row execute function public.protect_question_status_transition();
