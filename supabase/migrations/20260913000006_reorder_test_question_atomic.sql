-- Fix for a genuine correctness bug found on review of the Test Builder
-- work: reorderQuestion() (src/lib/actions/tests.ts) performed a two-row
-- position swap as three SEQUENTIAL, non-atomic REST calls (set A to a
-- temporary -1, set B to A's old position, set A to B's old position). If
-- the second or third call failed (network blip, dev-server restart, etc.),
-- a row was left permanently stuck at position -1 — not just a cosmetic
-- admin-UI issue: test_questions.position directly determines the exam's
-- question presentation order when shuffle_questions is false
-- (start_attempt: `order by ... tq.position`), so a corrupted position
-- would have been visible to students, not just admins.
--
-- Fix: do the swap as a single SECURITY DEFINER RPC. A function body is one
-- transaction regardless of how many statements it contains, so either both
-- UPDATEs happen or neither does — no intermediate state is ever
-- observable or persistable, and no temporary sentinel position is needed
-- at all (test_questions.position has no unique constraint, so there is no
-- transient-collision problem to work around inside a single transaction).
-- Matches the existing pattern of doing correctness-critical multi-row
-- writes (create_question_version, void_test_question, etc.) as one atomic
-- RPC rather than sequential client-side calls.
--
-- Authorization: is_admin() only — the existing
-- protect_published_test_questions() trigger (unchanged) still
-- independently blocks any position change once the test is not 'draft',
-- regardless of caller, since triggers fire on every UPDATE regardless of
-- the calling role. Semantics unchanged from the previous implementation:
-- "up"/"down" swap with the immediately-adjacent row by current position,
-- silently no-op at the first/last edge (same as before).
create or replace function public.reorder_test_question(
  p_test_id uuid, p_question_id uuid, p_direction text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a record;
  v_b record;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction: %', p_direction;
  end if;

  select id, position into v_a
  from public.test_questions
  where test_id = p_test_id and question_id = p_question_id;
  if not found then
    raise exception 'question not found in this test';
  end if;

  if p_direction = 'up' then
    select id, position into v_b
    from public.test_questions
    where test_id = p_test_id and position < v_a.position
    order by position desc limit 1;
  else
    select id, position into v_b
    from public.test_questions
    where test_id = p_test_id and position > v_a.position
    order by position asc limit 1;
  end if;

  if not found then
    return; -- already first/last: no-op, same as the previous implementation
  end if;

  update public.test_questions set position = v_b.position where id = v_a.id;
  update public.test_questions set position = v_a.position where id = v_b.id;
end;
$$;

revoke execute on function public.reorder_test_question(uuid, uuid, text) from public;
