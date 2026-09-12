-- 0013: exam engine — attempts, answers, RPCs, session exemption, auto-submit
-- docs/exam-state-machine.md and docs/scoring-rules.md are canonical.

create table public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'in_progress'
    check (state in ('in_progress', 'submitted', 'invalidated')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  submit_source text check (submit_source in ('student', 'auto', 'admin')),
  device_id uuid not null,
  session_id uuid,
  question_order uuid[] not null,      -- shuffled question_version_ids, frozen at start
  option_orders jsonb,                 -- {qv_id: [keys]} when shuffle_options
  invalidated_reason text,
  invalidated_by uuid references public.profiles (id),
  score numeric,
  max_score numeric,
  raw_correct int,
  raw_wrong int,
  raw_blank int,
  percentage numeric,
  rank int,
  percentile numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one live/submitted attempt per test+student; invalidated history preserved
create unique index test_attempts_one_live
  on public.test_attempts (test_id, student_id)
  where state <> 'invalidated';

create index test_attempts_test_state_idx on public.test_attempts (test_id, state);
create index test_attempts_student_idx on public.test_attempts (student_id);
create index test_attempts_expiry_idx on public.test_attempts (expires_at)
  where state = 'in_progress';
create index test_attempts_score_idx on public.test_attempts (test_id, score desc);

create trigger test_attempts_updated_at before update on public.test_attempts
  for each row execute function public.set_updated_at();

create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  attempt_id uuid not null references public.test_attempts (id) on delete cascade,
  question_version_id uuid not null references public.question_versions (id),
  selected_key char(1),
  marked_for_review boolean not null default false,
  answered_at timestamptz not null default now(),
  time_spent_ms int,
  save_seq bigint not null default 0,
  unique (attempt_id, question_version_id)
);

create index attempt_answers_attempt_idx on public.attempt_answers (attempt_id);

-- RLS: students read own; ALL writes via definer RPCs.
alter table public.test_attempts enable row level security;
alter table public.attempt_answers enable row level security;

create policy test_attempts_student_select on public.test_attempts
  for select using (student_id = (select auth.uid()) or public.is_admin());
create policy test_attempts_admin_write on public.test_attempts
  for update using (public.is_admin()) with check (public.is_admin());

create policy attempt_answers_select on public.attempt_answers
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.test_attempts a
      where a.id = attempt_answers.attempt_id
        and a.student_id = (select auth.uid())
        and a.state <> 'in_progress'
    )
  );

-- === session policy v2 (docs/permissions.md interaction rule) ===
create or replace function public.owns_live_attempt_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.test_attempts
    where student_id = (select auth.uid())
      and state = 'in_progress'
      and session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
  );
$$;

create or replace function public.is_active_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles
      where id = (select auth.uid())
        and active_session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
    )
    or public.owns_live_attempt_session();
$$;

-- === scoring (docs/scoring-rules.md; rank/percentile arrive with results phase) ===
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

  -- scored questions: non-voided, plus credit_all voids handled below
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
end;
$$;

-- === lazy finalize helper: expired in_progress -> submitted(auto) ===
create or replace function public.finalize_if_expired(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_done boolean;
begin
  update public.test_attempts
  set state = 'submitted', submitted_at = expires_at, submit_source = 'auto'
  where id = p_attempt_id
    and state = 'in_progress'
    and now() > expires_at + interval '60 seconds'
  returning true into v_done;
  if v_done then
    perform public.score_attempt(p_attempt_id);
  end if;
end;
$$;

-- === start / resume (docs/exam-state-machine.md) ===
create or replace function public.start_attempt(p_test_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  a public.test_attempts%rowtype;
  v_aid uuid;
  v_order uuid[];
  v_opt_orders jsonb;
  v_questions jsonb;
  v_answers jsonb;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;
  if not public.is_active_session() then
    raise exception 'session_superseded';
  end if;
  if not public.can_access_test(p_test_id) then
    raise exception 'test_access_denied';
  end if;

  select * into t from public.tests where id = p_test_id;
  if t.status <> 'published' or now() < t.opens_at or now() >= t.closes_at then
    -- allow resume-for-review path to fail clearly
    if exists (select 1 from public.test_attempts
      where test_id = p_test_id and student_id = (select auth.uid()) and state <> 'invalidated') then
      raise exception 'already_submitted';
    end if;
    raise exception 'test_window_closed';
  end if;

  -- fresh attempt (no-op if one exists)
  select array_agg(tq.question_version_id order by
      case when t.shuffle_questions then random() else tq.position::double precision end)
  into v_order
  from public.test_questions tq
  where tq.test_id = p_test_id;

  if t.shuffle_options then
    select jsonb_object_agg(qv.id, keys) into v_opt_orders
    from public.question_versions qv
    cross join lateral (
      select jsonb_agg(k order by random()) as keys
      from (select jsonb_array_elements(qv.options) ->> 'key' as k) s
    ) o
    where qv.id = any (v_order);
  end if;

  insert into public.test_attempts
    (test_id, student_id, expires_at, device_id, session_id, question_order, option_orders)
  values (
    p_test_id, (select auth.uid()),
    least(now() + t.duration_minutes * interval '1 minute', t.closes_at),
    p_device_id,
    nullif(auth.jwt() ->> 'session_id', '')::uuid,
    v_order, v_opt_orders
  )
  on conflict (test_id, student_id) where state <> 'invalidated' do nothing;

  select id into v_aid from public.test_attempts
  where test_id = p_test_id and student_id = (select auth.uid()) and state <> 'invalidated';

  perform public.finalize_if_expired(v_aid);
  select * into a from public.test_attempts where id = v_aid;

  if a.state = 'submitted' then
    raise exception 'already_submitted';
  end if;
  if a.device_id <> p_device_id then
    raise exception 'attempt_locked_other_device';
  end if;

  -- questions in the attempt's frozen order, WITHOUT correct_key/explanation
  select jsonb_agg(q order by q -> 'idx') into v_questions
  from (
    select jsonb_build_object(
      'idx', ord.idx,
      'question_version_id', qv.id,
      'stem', qv.stem,
      'options', case
        when a.option_orders is not null and a.option_orders ? qv.id::text then (
          select jsonb_agg(opt order by k.kidx)
          from jsonb_array_elements_text(a.option_orders -> qv.id::text) with ordinality k(key, kidx)
          join lateral (
            select o as opt from jsonb_array_elements(qv.options) o
            where o ->> 'key' = k.key
          ) m on true
        )
        else qv.options
      end
    ) as q
    from unnest(a.question_order) with ordinality ord(qv_id, idx)
    join public.question_versions qv on qv.id = ord.qv_id
  ) qs;

  select coalesce(jsonb_agg(jsonb_build_object(
    'question_version_id', question_version_id,
    'selected_key', trim(selected_key::text),
    'marked_for_review', marked_for_review,
    'save_seq', save_seq
  )), '[]'::jsonb) into v_answers
  from public.attempt_answers where attempt_id = a.id;

  return jsonb_build_object(
    'attempt_id', a.id,
    'started_at', a.started_at,
    'expires_at', a.expires_at,
    'server_now', now(),
    'test_title', t.title,
    'questions', coalesce(v_questions, '[]'::jsonb),
    'answers', v_answers
  );
end;
$$;

-- === autosave (idempotent, monotonic save_seq, transport grace) ===
create or replace function public.save_answer(
  p_attempt_id uuid,
  p_question_version_id uuid,
  p_selected_key char,
  p_marked_for_review boolean,
  p_save_seq bigint,
  p_device_id uuid,
  p_time_spent_ms int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.test_attempts%rowtype;
begin
  select * into a from public.test_attempts
  where id = p_attempt_id and student_id = (select auth.uid());
  if not found then raise exception 'attempt_not_found'; end if;
  if a.state <> 'in_progress' then raise exception 'attempt_finalized'; end if;
  if a.device_id <> p_device_id then raise exception 'attempt_locked_other_device'; end if;
  -- transport grace ONLY: delivery tolerance for answers picked before expiry
  if now() > a.expires_at + interval '30 seconds' then
    raise exception 'attempt_expired';
  end if;
  if not (p_question_version_id = any (a.question_order)) then
    raise exception 'question_not_in_attempt';
  end if;

  insert into public.attempt_answers
    (attempt_id, question_version_id, selected_key, marked_for_review, save_seq, time_spent_ms)
  values
    (p_attempt_id, p_question_version_id, p_selected_key, coalesce(p_marked_for_review, false),
     coalesce(p_save_seq, 0), p_time_spent_ms)
  on conflict (attempt_id, question_version_id) do update
    set selected_key = excluded.selected_key,
        marked_for_review = excluded.marked_for_review,
        save_seq = excluded.save_seq,
        time_spent_ms = coalesce(excluded.time_spent_ms, attempt_answers.time_spent_ms),
        answered_at = now()
    where attempt_answers.save_seq < excluded.save_seq;

  return jsonb_build_object('saved', true, 'server_now', now(), 'expires_at', a.expires_at);
end;
$$;

-- === submit (idempotent success on duplicates) ===
create or replace function public.submit_attempt(p_attempt_id uuid, p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.test_attempts%rowtype;
  v_updated boolean := false;
begin
  update public.test_attempts
  set state = 'submitted', submitted_at = now(), submit_source = 'student'
  where id = p_attempt_id
    and student_id = (select auth.uid())
    and state = 'in_progress'
    and device_id = p_device_id
    and now() <= expires_at + interval '30 seconds'
  returning true into v_updated;

  if v_updated then
    perform public.score_attempt(p_attempt_id);
  else
    select * into a from public.test_attempts
    where id = p_attempt_id and student_id = (select auth.uid());
    if not found then raise exception 'attempt_not_found'; end if;
    if a.state = 'in_progress' then
      if a.device_id <> p_device_id then
        raise exception 'attempt_locked_other_device';
      end if;
      -- past transport grace: finalize as auto (answers after expiry were never accepted)
      update public.test_attempts
      set state = 'submitted', submitted_at = expires_at, submit_source = 'auto'
      where id = p_attempt_id and state = 'in_progress';
      perform public.score_attempt(p_attempt_id);
    end if;
    -- already submitted -> idempotent success falls through
  end if;

  select * into a from public.test_attempts where id = p_attempt_id;
  return jsonb_build_object(
    'attempt_id', a.id,
    'state', a.state,
    'score', a.score,
    'max_score', a.max_score,
    'raw_correct', a.raw_correct,
    'raw_wrong', a.raw_wrong,
    'raw_blank', a.raw_blank,
    'percentage', a.percentage,
    'submit_source', a.submit_source
  );
end;
$$;

-- === cron finalizer ===
create or replace function public.auto_submit_expired()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  select array_agg(id) into v_ids
  from public.test_attempts
  where state = 'in_progress' and now() > expires_at + interval '60 seconds';

  if v_ids is null then return 0; end if;

  update public.test_attempts
  set state = 'submitted', submitted_at = expires_at, submit_source = 'auto'
  where id = any (v_ids) and state = 'in_progress';

  foreach v_id in array v_ids loop
    perform public.score_attempt(v_id);
  end loop;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- === admin: controlled retake (docs/test-rules.md attempt reset) ===
create or replace function public.invalidate_attempt(p_attempt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  update public.test_attempts
  set state = 'invalidated',
      invalidated_reason = p_reason,
      invalidated_by = (select auth.uid())
  where id = p_attempt_id and state in ('in_progress', 'submitted');
  if not found then raise exception 'attempt not found or already invalidated'; end if;
  perform public.log_audit('attempt_invalidated', 'attempt', p_attempt_id,
    jsonb_build_object('reason', p_reason));
end;
$$;

-- pg_cron: belt-and-suspenders finalizer (Vercel cron is the backup)
do $$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('medverse-auto-submit', '* * * * *',
      'select public.auto_submit_expired()');
  exception when others then
    raise notice 'pg_cron unavailable (%), relying on external cron', SQLERRM;
  end;
end $$;
