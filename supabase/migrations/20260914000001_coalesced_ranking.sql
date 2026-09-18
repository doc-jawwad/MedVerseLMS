-- Coalesced ranking (docs/scoring-rules.md).
--
-- Product semantics of rank_test() are unchanged (RANK() + percentile, including
-- the n<=1 null-percentile exception in 20260912000025). What changes is *when*
-- rank_test runs:
--   before: score_attempt -> rank_test on every submit / every auto-submit loop
--   after:  score_attempt writes score fields and marks tests.rank_dirty_at;
--           rank_dirty_tests() runs rank_test once per dirty test.
--
-- Scheduling (not a new debounce interval): reuse the already-documented
-- medverse-auto-submit pg_cron job ('* * * * *'). auto_submit_expired() now
-- always drains dirty ranks at the end, even when zero attempts expired, so
-- isolated student submits wait at most one existing auto-submit window.
-- The HTTP backup cron (GET /api/cron/auto-submit) calls the same function.
-- recompute_test still ranks once at the end (admin void path).

alter table public.tests
  add column if not exists rank_dirty_at timestamptz;

-- protect_published_test() only freezes explicit config columns; rank_dirty_at
-- is intentionally not in that list so published tests can be marked dirty.

create index if not exists tests_rank_dirty_idx
  on public.tests (id)
  where rank_dirty_at is not null;

-- Drain every dirty test: clear the marker first so a concurrent submit that
-- lands during rank_test re-sets dirty and is picked up on the next tick.
create or replace function public.rank_dirty_tests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  for v_id in
    select id from public.tests where rank_dirty_at is not null
  loop
    update public.tests set rank_dirty_at = null where id = v_id;
    perform public.rank_test(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Score fields only; mark the test dirty. Do not call rank_test here.
create or replace function public.score_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  v_correct int;
  v_wrong int;
  v_total int;
  v_max numeric;
  v_score numeric;
begin
  select * into a from public.test_attempts where id = p_attempt_id;
  select * into t from public.tests where id = a.test_id;

  with scored as (
    select
      tq.question_version_id,
      coalesce(tq.marks, t.marks_per_question) as marks,
      tq.voided,
      tq.void_policy,
      qv.correct_key,
      ans.selected_key
    from public.test_questions tq
    join public.question_versions qv on qv.id = tq.question_version_id
    left join public.attempt_answers ans
      on ans.attempt_id = p_attempt_id
     and ans.question_version_id = tq.question_version_id
    where tq.test_id = a.test_id
      and not (tq.voided and tq.void_policy = 'exclude')
  )
  select
    count(*) filter (where (voided and void_policy = 'credit_all')
                        or selected_key = correct_key),
    count(*) filter (where not (voided and void_policy = 'credit_all')
                        and selected_key is not null
                        and selected_key <> correct_key),
    count(*),
    coalesce(sum(marks), 0),
    coalesce(sum(
      case
        when (voided and void_policy = 'credit_all') then marks
        when selected_key = correct_key then marks
        when selected_key is not null then -t.negative_mark
        else 0
      end
    ), 0)
  into v_correct, v_wrong, v_total, v_max, v_score
  from scored;

  update public.test_attempts
  set score = round(v_score, 2),
      max_score = round(v_max, 2),
      raw_correct = v_correct,
      raw_wrong = v_wrong,
      raw_blank = v_total - v_correct - v_wrong,
      percentage = case when v_max > 0 then round(100.0 * v_score / v_max, 2) else 0 end
  where id = p_attempt_id;

  update public.tests
  set rank_dirty_at = now()
  where id = a.test_id;
end;
$$;

-- Score expired attempts, then rank each dirty test once (including tests
-- dirtied by earlier student submits in this minute window).
create or replace function public.auto_submit_expired()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_n int := 0;
begin
  select array_agg(id) into v_ids
  from public.test_attempts
  where state = 'in_progress' and now() > expires_at + interval '60 seconds';

  if v_ids is not null then
    update public.test_attempts
    set state = 'submitted', submitted_at = expires_at, submit_source = 'auto'
    where id = any (v_ids) and state = 'in_progress';

    foreach v_id in array v_ids loop
      perform public.score_attempt(v_id);
    end loop;

    v_n := coalesce(array_length(v_ids, 1), 0);
  end if;

  perform public.rank_dirty_tests();
  return v_n;
end;
$$;

-- Admin void/rescore path: still rank once at the end, then clear dirty so
-- the next cron tick does not immediately re-rank the same snapshot.
create or replace function public.recompute_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  rec record;
  v_correct int; v_wrong int; v_total int; v_max numeric; v_score numeric;
begin
  select * into t from public.tests where id = p_test_id;

  for rec in
    select id from public.test_attempts
    where test_id = p_test_id and state = 'submitted'
  loop
    with scored as (
      select
        tq.question_version_id,
        coalesce(tq.marks, t.marks_per_question) as marks,
        tq.voided, tq.void_policy,
        qv.correct_key, ans.selected_key
      from public.test_questions tq
      join public.question_versions qv on qv.id = tq.question_version_id
      left join public.attempt_answers ans
        on ans.attempt_id = rec.id and ans.question_version_id = tq.question_version_id
      where tq.test_id = p_test_id
        and not (tq.voided and tq.void_policy = 'exclude')
    )
    select
      count(*) filter (where (voided and void_policy = 'credit_all')
                          or selected_key = correct_key),
      count(*) filter (where not (voided and void_policy = 'credit_all')
                          and selected_key is not null and selected_key <> correct_key),
      count(*),
      coalesce(sum(marks), 0),
      coalesce(sum(
        case
          when (voided and void_policy = 'credit_all') then marks
          when selected_key = correct_key then marks
          when selected_key is not null then -t.negative_mark
          else 0
        end
      ), 0)
    into v_correct, v_wrong, v_total, v_max, v_score
    from scored;

    update public.test_attempts
    set score = round(v_score, 2),
        max_score = round(v_max, 2),
        raw_correct = v_correct,
        raw_wrong = v_wrong,
        raw_blank = v_total - v_correct - v_wrong,
        percentage = case when v_max > 0 then round(100.0 * v_score / v_max, 2) else 0 end
    where id = rec.id;
  end loop;

  perform public.rank_test(p_test_id);
  update public.tests set rank_dirty_at = null where id = p_test_id;
end;
$$;

-- Group B: no legitimate client caller (same treatment as rank_test).
-- Nested calls from auto_submit_expired / SECURITY DEFINER do not need grants.
revoke execute on function public.rank_dirty_tests() from public, anon, authenticated;
