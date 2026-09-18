-- Move the coalesced-rank dirty signal off tests.rank_dirty_at so concurrent
-- same-test submit_attempt/score_attempt calls do not serialize on the tests row.
-- rank_test / rank_dirty_tests coalescing / cron tick are unchanged.
-- tests.rank_dirty_at is still drained if set (older writers / leftover rows).

create table public.rank_dirty_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  test_id uuid not null references public.tests (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rank_dirty_queue_test_idx on public.rank_dirty_queue (test_id);

create trigger rank_dirty_queue_updated_at
  before update on public.rank_dirty_queue
  for each row execute function public.set_updated_at();

alter table public.rank_dirty_queue enable row level security;
revoke all on table public.rank_dirty_queue from public, anon, authenticated;

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
    select distinct test_id from (
      select test_id from public.rank_dirty_queue
      union
      select id from public.tests where rank_dirty_at is not null
    ) d
  loop
    delete from public.rank_dirty_queue where test_id = v_id;
    update public.tests set rank_dirty_at = null
      where id = v_id and rank_dirty_at is not null;
    perform public.rank_test(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

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

  insert into public.rank_dirty_queue (test_id) values (a.test_id);
end;
$$;

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

  delete from public.rank_dirty_queue where test_id = p_test_id;
  perform public.rank_test(p_test_id);
  update public.tests set rank_dirty_at = null where id = p_test_id;
end;
$$;

comment on table public.rank_dirty_queue is
  'Append-only dirty signal for coalesced rank_test. score_attempt inserts; rank_dirty_tests distinct-drains then ranks.';

revoke execute on function public.rank_dirty_tests() from public, anon, authenticated;
revoke execute on function public.score_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.recompute_test(uuid) from public, anon, authenticated;
