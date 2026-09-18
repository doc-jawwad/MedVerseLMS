-- 8J-C: close_test_now clamps live in_progress expires_at; start_attempt
-- resume-while-closed reaches finalize_if_expired. Does not change 8J-A/B,
-- client timers (8J-D), autosave UX (8J-E), eligibility snapshots, or ranking.

-- Kill switch: close admission and clamp live deadlines. Never extends
-- expires_at. Does not force-submit. Existing 30s/60s clocks apply to the
-- clamped instant.
create or replace function public.close_test_now(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed_at timestamptz;
begin
  perform public.require_permission('publish_tests');

  update public.tests
  set closes_at = now(), status = 'closed'
  where id = p_test_id and status = 'published'
  returning closes_at into v_closed_at;
  if not found then
    raise exception 'test is not published';
  end if;

  -- least() never extends. Submitted / invalidated rows are not in_progress.
  update public.test_attempts
  set expires_at = least(expires_at, v_closed_at)
  where test_id = p_test_id
    and state = 'in_progress';

  perform public.log_audit('test_closed_now', 'test', p_test_id);
end;
$$;

-- Resume skips published/window/entitlement (close-now + paid expiry).
-- New starts still require those checks. Test row is locked so a concurrent
-- close_test_now either waits and then clamps the new row, or commits first
-- and the new start sees the closed window.
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
  v_resuming boolean;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  -- Layer 2 always. Resume of leave_in_progress uses the exam-session exemption.
  if not public.is_active_session() then
    raise exception 'session_superseded';
  end if;

  -- Serialize with close_test_now (which UPDATEs this row first).
  select * into t from public.tests where id = p_test_id for update;
  if not found then
    raise exception 'test_window_closed';
  end if;

  v_resuming := exists (
    select 1 from public.test_attempts
    where test_id = p_test_id
      and student_id = (select auth.uid())
      and state = 'in_progress'
  );

  -- New attempts require an active account even if Layer 1 was already kicked.
  -- Resume of leave_in_progress skips this and uses is_active_session() exemption.
  if not v_resuming and not public.account_allows_lms() then
    raise exception 'account_blocked';
  end if;
  if not v_resuming and not public.can_access_test(p_test_id) then
    raise exception 'test_access_denied';
  end if;

  if not v_resuming then
    if t.status <> 'published' or now() < t.opens_at or now() >= t.closes_at then
      if exists (
        select 1 from public.test_attempts
        where test_id = p_test_id
          and student_id = (select auth.uid())
          and state <> 'invalidated'
      ) then
        raise exception 'already_submitted';
      end if;
      raise exception 'test_window_closed';
    end if;
  end if;

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

-- Lock the attempt row so close_test_now's clamp is visible before the
-- transport-grace check. Does not add a test.closed condition.
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
  where id = p_attempt_id and student_id = (select auth.uid())
  for update;
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
