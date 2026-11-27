-- Frozen exam membership, publication and year-change concurrency (#38).
-- Plan: docs/plans/frozen-exam-membership-concurrency-20261127.md (r3, accepted).
--
-- Prevention only. No DML on existing rows, no backfill, no validation scan,
-- no table/index/RLS/grant change except REVOKEs on new internal functions.
-- Historical published tests, links, attempts and scores are not touched.
--
-- Lock protocol (docs/database.md): a test's test_questions rows (asc id)
--   -> the tests row -> questions rows (asc id).
-- Executor-driven UPDATE/DELETE on test_questions lock the child tuple before
-- any BEFORE ROW trigger runs, so every RPC that writes a test's links locks
-- them child-first too.

-- ---------------------------------------------------------------------------
-- L0: internal child-first lock helper. Not callable by any API role.
-- ---------------------------------------------------------------------------
create function public.private_lock_test_links(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1
  from public.test_questions tq
  where tq.test_id = p_test_id
  order by tq.id
  for no key update of tq;
end;
$$;

revoke all on function public.private_lock_test_links(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- L1: publish_test — permission first, then links -> test -> questions,
-- then validation, freeze and status. Error contract unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.publish_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  n_unfrozen int;
  v_status text;
begin
  perform public.require_permission('publish_tests');

  perform public.private_lock_test_links(p_test_id);

  select t.status into v_status
  from public.tests t
  where t.id = p_test_id
  for update;
  if not found then
    raise exception 'test not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft tests can be published';
  end if;

  -- Links inserted (and committed) while we waited for the test row.
  perform public.private_lock_test_links(p_test_id);

  -- Member questions before validation: approval, soft delete, year and
  -- current version are read from locked, committed rows.
  perform 1
  from public.questions q
  where q.id in (
    select tq.question_id from public.test_questions tq
    where tq.test_id = p_test_id
  )
  order by q.id
  for no key update of q;

  for item in select * from jsonb_array_elements(public.validate_test(p_test_id)) loop
    if not (item ->> 'pass')::boolean then
      raise exception 'validation failed: %', item ->> 'check';
    end if;
  end loop;

  -- freeze current versions
  update public.test_questions tq
  set question_version_id = q.current_version_id
  from public.questions q
  where tq.test_id = p_test_id and q.id = tq.question_id;

  select count(*) into n_unfrozen
  from public.test_questions
  where test_id = p_test_id and question_version_id is null;
  if n_unfrozen > 0 then
    raise exception 'validation failed: question versions freeze';
  end if;

  update public.tests set status = 'published' where id = p_test_id;

  -- refresh the UI cache flag (never authoritative)
  update public.questions q set used_in_test = true
  where q.id in (select question_id from public.test_questions where test_id = p_test_id);

  perform public.log_audit('test_published', 'test', p_test_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- L2: link triggers read the parent test(s) under a row lock.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_test_question_year_on_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_test_year uuid;
  v_question_year uuid;
begin
  -- Reparent: both parents, ascending id (the only child is already held).
  if tg_op = 'UPDATE' and new.test_id is distinct from old.test_id then
    perform 1 from public.tests t
    where t.id in (old.test_id, new.test_id)
    order by t.id
    for no key update of t;
  end if;

  select t.year_id into v_test_year
  from public.tests t where t.id = new.test_id
  for no key update of t;

  select q.year_id into v_question_year
  from public.questions q where q.id = new.question_id;

  -- Existing foreign keys handle missing test/question references.
  if v_test_year is not null and v_question_year is not null
     and v_test_year is distinct from v_question_year then
    raise exception 'test_question_year_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Invoker (as before). UPDATE/DELETE reach this trigger only for rows that
-- passed the publish_tests USING policy, which is also the tests UPDATE
-- policy, so the lock below is never filtered for a legitimate writer.
-- INSERT is locked by the definer year trigger above (it fires first); the
-- invoker lock here is then a no-op, and unauthorized inserts keep failing
-- with the existing RLS WITH CHECK error.
create or replace function public.protect_published_test_questions()
returns trigger language plpgsql set search_path = public as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' and new.test_id is distinct from old.test_id then
    perform 1 from public.tests t
    where t.id in (old.test_id, new.test_id)
    order by t.id
    for no key update of t;
  else
    perform 1 from public.tests t
    where t.id = coalesce(new.test_id, old.test_id)
    for no key update of t;
  end if;

  select status into v_status from public.tests
  where id = coalesce(new.test_id, old.test_id);

  -- Fail closed: an authorized UPDATE always sees its parent.
  if tg_op = 'UPDATE' and v_status is null then
    raise exception 'questions of a published test are frozen';
  end if;

  -- A reparent changes both source and destination exam membership.
  if tg_op = 'UPDATE' and new.test_id is distinct from old.test_id then
    if v_status is distinct from 'draft' or not exists (
      select 1 from public.tests t
      where t.id = old.test_id and t.status = 'draft'
    ) then
      raise exception 'questions of a published test are frozen';
    end if;
  end if;

  if v_status <> 'draft' then
    if tg_op in ('INSERT', 'DELETE') then
      raise exception 'questions of a published test are frozen';
    end if;
    if new.question_id is distinct from old.question_id
       or new.question_version_id is distinct from old.question_version_id
       or new.position is distinct from old.position
       or new.marks is distinct from old.marks then
      raise exception 'only voiding may change on a published test';
    end if;
  end if;
  return coalesce(new, old);
end; $$;

-- ---------------------------------------------------------------------------
-- L3 / L3': parent-first RPCs take the links first.
-- ---------------------------------------------------------------------------
create or replace function public.return_to_draft_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tests%rowtype;
  v_attempts int;
begin
  perform public.require_permission('publish_tests');

  if p_test_id is null then
    raise exception 'test_not_found';
  end if;

  -- Published source cannot gain links, so one child-first pass suffices.
  perform public.private_lock_test_links(p_test_id);

  select * into v_row
  from public.tests t
  where t.id = p_test_id
  for update;

  if not found then
    raise exception 'test_not_found';
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'test_not_published_unopened';
  end if;

  if v_row.opens_at is null or v_row.opens_at <= now() then
    raise exception 'test_already_open_or_unscheduled';
  end if;

  -- Any attempt history (including invalidated) blocks the transition.
  select count(*)::int into v_attempts
  from public.test_attempts a
  where a.test_id = p_test_id;

  if v_attempts > 0 then
    raise exception 'test_has_attempts';
  end if;

  update public.tests
  set status = 'draft',
      updated_at = now()
  where id = p_test_id;

  -- Clear frozen versions so republish re-freezes current_version_id.
  update public.test_questions
  set question_version_id = null
  where test_id = p_test_id;

  perform public.log_audit(
    'test_returned_to_draft',
    'test',
    p_test_id,
    jsonb_build_object(
      'title', v_row.title,
      'opens_at', v_row.opens_at,
      'closes_at', v_row.closes_at
    )
  );
end;
$$;

create or replace function public.delete_draft_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_status text;
begin
  perform public.require_permission('publish_tests');

  if p_test_id is null then
    raise exception 'test_not_found';
  end if;

  perform public.private_lock_test_links(p_test_id);

  select t.title, t.status
    into v_title, v_status
  from public.tests t
  where t.id = p_test_id
  for update;

  if not found then
    raise exception 'test_not_found';
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'test_not_draft';
  end if;

  -- L3': links inserted while we waited for the test row.
  perform public.private_lock_test_links(p_test_id);

  -- Audit before hard delete (row gone afterward). Cascades composition rows
  -- (test_questions / test_audiences / test_prep_guidelines / access_grants).
  perform public.log_audit(
    'test_draft_deleted',
    'test',
    p_test_id,
    jsonb_build_object('title', v_title, 'status', v_status)
  );

  delete from public.tests where id = p_test_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- L4: reorder locks its two link rows in id order, then re-reads positions.
-- ---------------------------------------------------------------------------
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
  v_a_pos int;
  v_b_pos int;
begin
  perform public.require_permission('publish_tests');
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

  perform 1 from public.test_questions tq
  where tq.id in (v_a.id, v_b.id)
  order by tq.id
  for no key update of tq;

  select position into v_a_pos from public.test_questions where id = v_a.id;
  select position into v_b_pos from public.test_questions where id = v_b.id;

  update public.test_questions set position = v_b_pos where id = v_a.id;
  update public.test_questions set position = v_a_pos where id = v_b.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- C1: question_count stays exact across draft -> draft reparent.
-- ---------------------------------------------------------------------------
create or replace function public.sync_test_question_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.test_id is not distinct from old.test_id then
      return null;
    end if;
    update public.tests t
    set question_count = (
      select count(*) from public.test_questions where test_id = t.id
    )
    where t.id in (old.test_id, new.test_id);
    return null;
  end if;

  update public.tests
  set question_count = (
    select count(*) from public.test_questions where test_id = coalesce(new.test_id, old.test_id)
  )
  where id = coalesce(new.test_id, old.test_id);
  return null;
end;
$$;

drop trigger test_questions_sync_count on public.test_questions;
create trigger test_questions_sync_count
  after insert or delete or update of test_id on public.test_questions
  for each row execute function public.sync_test_question_count();

-- ---------------------------------------------------------------------------
-- Y1: a question's year cannot change while linked to a test of its current
-- year (any status). Existing wrong-year links never match old.year_id.
-- Sorts after questions_sync_ancestors, so it sees the derived year.
-- ---------------------------------------------------------------------------
create function public.guard_question_linked_year()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.test_questions tq
    join public.tests t on t.id = tq.test_id
    where tq.question_id = new.id
      and t.year_id = old.year_id
      and t.year_id is distinct from new.year_id
  ) then
    raise exception 'test_question_year_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_question_linked_year()
  from public, anon, authenticated;

create trigger questions_zz_guard_linked_year
  before update on public.questions
  for each row
  when (new.year_id is distinct from old.year_id)
  execute function public.guard_question_linked_year();

-- ---------------------------------------------------------------------------
-- Y2: a draft test's year cannot change while it holds questions of its
-- current year. Runs under the tests row lock taken by the UPDATE itself.
-- ---------------------------------------------------------------------------
create function public.guard_draft_test_year_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.test_questions tq
    join public.questions q on q.id = tq.question_id
    where tq.test_id = new.id
      and q.year_id = old.year_id
      and q.year_id is distinct from new.year_id
  ) then
    raise exception 'test_question_year_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_draft_test_year_change()
  from public, anon, authenticated;

create trigger tests_zz_guard_draft_year
  before update of year_id on public.tests
  for each row
  when (old.status = 'draft' and new.year_id is distinct from old.year_id)
  execute function public.guard_draft_test_year_change();

-- ---------------------------------------------------------------------------
-- G0: tests are created as draft, by every path.
-- ---------------------------------------------------------------------------
create function public.guard_test_initial_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception 'tests_must_be_created_as_draft' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_test_initial_status()
  from public, anon, authenticated;

create trigger tests_zz_guard_initial_status
  before insert on public.tests
  for each row
  execute function public.guard_test_initial_status();

-- ---------------------------------------------------------------------------
-- G1/G2/G3: status transitions into published / draft re-check the RPC
-- preconditions on every path. Sorts after every other tests trigger, so it
-- sees the final NEW (incl. tests_updated_at).
-- ---------------------------------------------------------------------------
create function public.guard_test_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_attempts int;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- G3: a draft leaves draft only by publication.
  if old.status = 'draft' and new.status is distinct from 'published' then
    raise exception 'only draft tests can be published';
  end if;

  if new.status not in ('published', 'draft') then
    return new; -- close / invalidate / archive: not membership-mutating
  end if;

  -- Isolation: nothing but status (and the updated_at stamp) may change.
  if (to_jsonb(new) - array['status', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'updated_at']) then
    raise exception 'test_status_change_must_be_isolated' using errcode = '23514';
  end if;

  if new.status = 'published' then
    -- G1 (a)
    if old.status is distinct from 'draft' then
      raise exception 'only draft tests can be published';
    end if;

    -- G1 (b): member questions, ascending id (no-op re-lock in publish_test).
    perform 1
    from public.questions q
    where q.id in (
      select tq.question_id from public.test_questions tq
      where tq.test_id = new.id
    )
    order by q.id
    for no key update of q;

    -- G1 (b'): year re-check on locked rows.
    if exists (
      select 1
      from public.test_questions tq
      join public.questions q on q.id = tq.question_id
      where tq.test_id = new.id
        and q.year_id is distinct from new.year_id
    ) then
      raise exception 'test_question_year_mismatch' using errcode = '23514';
    end if;

    -- G1 (c): every link frozen to its own question's current version.
    if exists (
      select 1
      from public.test_questions tq
      join public.questions q on q.id = tq.question_id
      left join public.question_versions qv on qv.id = tq.question_version_id
      where tq.test_id = new.id
        and (
          tq.question_version_id is null
          or qv.question_id is distinct from tq.question_id
          or tq.question_version_id is distinct from q.current_version_id
        )
    ) then
      raise exception 'validation failed: question versions freeze';
    end if;

    -- G1 (d): full validation of the persisted (isolated) config.
    for item in select * from jsonb_array_elements(public.validate_test(new.id)) loop
      if not (item ->> 'pass')::boolean then
        raise exception 'validation failed: %', item ->> 'check';
      end if;
    end loop;
  else
    -- G2: return_to_draft_test preconditions, verbatim.
    if old.status is distinct from 'published' then
      raise exception 'test_not_published_unopened';
    end if;
    if old.opens_at is null or old.opens_at <= now() then
      raise exception 'test_already_open_or_unscheduled';
    end if;
    select count(*)::int into v_attempts
    from public.test_attempts a
    where a.test_id = new.id;
    if v_attempts > 0 then
      raise exception 'test_has_attempts';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_test_status_transition()
  from public, anon, authenticated;

create trigger tests_zz_guard_status_transition
  before update of status on public.tests
  for each row
  execute function public.guard_test_status_transition();
