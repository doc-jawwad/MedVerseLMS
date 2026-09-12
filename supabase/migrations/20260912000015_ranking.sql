-- 0015: ranking + real recompute_test (docs/scoring-rules.md)
-- rank_test() re-runs after every score_attempt call; recompute_test() rescores
-- every submitted attempt of a test (used by void_test_question) then re-ranks.

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
        else 100.0
      end
  from ranked
  where a.id = ranked.id;
end;
$$;

-- score_attempt no longer stands alone: every call is followed by a re-rank of
-- the whole test so rank/percentile stay consistent (docs/scoring-rules.md).
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

  perform public.rank_test(a.test_id);
end;
$$;

-- Real recompute: rescore every submitted attempt (e.g. after a question void),
-- then rank once at the end (avoids O(n) re-ranks during the loop).
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
end;
$$;

-- Leaderboard: rank table for a published/closed test. Any student with
-- access to the test may view it (name masking left to the app if desired;
-- single academy, admin chose full names — docs/database.md leaderboard note).
create or replace function public.test_leaderboard(p_test_id uuid)
returns table (
  rank int,
  percentile numeric,
  student_id uuid,
  full_name text,
  score numeric,
  max_score numeric,
  percentage numeric,
  is_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.rank, a.percentile, a.student_id, p.full_name,
         a.score, a.max_score, a.percentage,
         a.student_id = (select auth.uid())
  from public.test_attempts a
  join public.profiles p on p.id = a.student_id
  where a.test_id = p_test_id
    and a.state = 'submitted'
    and (public.can_access_test(p_test_id) or public.is_admin())
  order by a.rank asc nulls last;
$$;

-- Admin per-test summary (docs/database.md test_stats intent, computed live for now).
create or replace function public.test_summary(p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_registered int;
  v_attempted int;
  v_completed int;
  v_avg numeric;
  v_median numeric;
  v_max numeric;
  v_min numeric;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select count(distinct e.student_id) into v_registered
  from public.tests t
  join public.test_audiences ta on ta.test_id = t.id
  join public.enrollments e on e.year_id = ta.year_id and e.status = 'active'
  where t.id = p_test_id;

  select count(*) filter (where state in ('in_progress', 'submitted')),
         count(*) filter (where state = 'submitted'),
         avg(score) filter (where state = 'submitted'),
         percentile_cont(0.5) within group (order by score) filter (where state = 'submitted'),
         max(score) filter (where state = 'submitted'),
         min(score) filter (where state = 'submitted')
  into v_attempted, v_completed, v_avg, v_median, v_max, v_min
  from public.test_attempts
  where test_id = p_test_id;

  return jsonb_build_object(
    'registered', coalesce(v_registered, 0),
    'attempted', coalesce(v_attempted, 0),
    'completed', coalesce(v_completed, 0),
    'average_score', round(coalesce(v_avg, 0), 2),
    'median_score', round(coalesce(v_median, 0), 2),
    'highest_score', coalesce(v_max, 0),
    'lowest_score', coalesce(v_min, 0)
  );
end;
$$;
