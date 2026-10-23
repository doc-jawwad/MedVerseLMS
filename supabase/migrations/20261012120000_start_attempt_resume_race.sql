-- Forward-only fix for a concurrency race in start_attempt (found by the staging
-- concurrency check on 20261012090000): two simultaneous identical starts could
-- make the loser raise attempt_limit_reached / already_submitted instead of
-- resuming the winner's live attempt, because "is there a live attempt?" and
-- "how many attempts?" were read in separate statements.
--
-- Change (only this): the pre-lock decision reads both numbers in one statement
-- and does not reject when a live attempt exists. Everything else is unchanged:
-- tests FOR UPDATE ordering, limit/attempt-number contracts, device lock,
-- entitlement and window checks, signature, ACLs. Same signature => CREATE OR
-- REPLACE (no drop). Original migration 20261012090000 is not modified.

set local lock_timeout = '10s';

create or replace function public.start_attempt(
  p_test_id uuid,
  p_device_id uuid,
  p_attempt_no int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  a public.test_attempts%rowtype;
  v_uid uuid := (select auth.uid());
  v_counted int;
  v_live_n int;
  v_decision text;
  v_order uuid[];
  v_opt_orders jsonb;
  v_questions jsonb;
  v_answers jsonb;
  v_attempt_no int;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  select * into a
  from public.test_attempts
  where test_id = p_test_id
    and student_id = v_uid
    and state = 'in_progress';

  if found then
    -- Resume (any max_attempts / any p_attempt_no): skips can_access_test,
    -- published and the live window; same-device only.
    perform public.finalize_if_expired(a.id);
    select * into a from public.test_attempts where id = a.id;

    if a.state = 'submitted' then
      select * into t from public.tests where id = p_test_id;
      return jsonb_build_object(
        'already_submitted', true,
        'attempt_id', a.id,
        'started_at', a.started_at,
        'expires_at', a.expires_at,
        'server_now', now(),
        'test_title', coalesce(t.title, '')
      );
    end if;

    if not public.is_active_session() then
      raise exception 'session_superseded';
    end if;

    select * into t from public.tests where id = p_test_id;
    if not found then
      raise exception 'test_window_closed';
    end if;

    if a.device_id <> p_device_id then
      raise exception 'attempt_locked_other_device';
    end if;
  else
    -- No live attempt: single-attempt / exhausted / stale outcomes are decided
    -- before session and entitlement checks (prefer already_submitted etc.).
    select * into t from public.tests where id = p_test_id;
    if found then
      -- ONE statement => one snapshot for both numbers. Reading the live
      -- attempt and the count in separate statements let a concurrent
      -- identical start commit in between, so this request saw "no live
      -- attempt" but counted it and wrongly raised attempt_limit_reached.
      select count(*) filter (where state in ('in_progress', 'submitted')),
             count(*) filter (where state = 'in_progress')
      into v_counted, v_live_n
      from public.test_attempts
      where test_id = p_test_id
        and student_id = v_uid;
      v_decision := public.attempt_start_decision(t.max_attempts, v_counted, p_attempt_no);
      -- A live attempt that appeared after the resume read above belongs to a
      -- concurrent start: do not reject; the locked section below resumes it
      -- (same device) or raises attempt_locked_other_device.
      if v_decision <> 'new' and v_live_n = 0 then
        raise exception '%', v_decision;
      end if;
    end if;

    if not public.is_active_session() then
      raise exception 'session_superseded';
    end if;
    if not public.account_allows_lms() then
      raise exception 'account_blocked';
    end if;
    if not public.can_access_test(p_test_id) then
      raise exception 'test_access_denied';
    end if;

    select * into t from public.tests where id = p_test_id;
    if not found then
      raise exception 'test_window_closed';
    end if;

    if t.status <> 'published' or now() < t.opens_at or now() >= t.closes_at then
      raise exception 'test_window_closed';
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

    -- Serialize new starts (and close_test_now) around admission + insert.
    -- Attempt counts are re-read under this lock so concurrent starts cannot
    -- both pass the limit check.
    select * into t from public.tests where id = p_test_id for update;
    if not found then
      raise exception 'test_window_closed';
    end if;

    if t.status <> 'published' or now() < t.opens_at or now() >= t.closes_at then
      raise exception 'test_window_closed';
    end if;

    select * into a
    from public.test_attempts
    where test_id = p_test_id
      and student_id = v_uid
      and state = 'in_progress';

    if not found then
      select count(*) into v_counted
      from public.test_attempts
      where test_id = p_test_id
        and student_id = v_uid
        and state in ('in_progress', 'submitted');
      v_decision := public.attempt_start_decision(t.max_attempts, v_counted, p_attempt_no);
      if v_decision <> 'new' then
        raise exception '%', v_decision;
      end if;

      insert into public.test_attempts
        (test_id, student_id, expires_at, device_id, session_id, question_order, option_orders)
      values (
        p_test_id, v_uid,
        least(now() + t.duration_minutes * interval '1 minute', t.closes_at),
        p_device_id,
        nullif(auth.jwt() ->> 'session_id', '')::uuid,
        v_order, v_opt_orders
      )
      on conflict (test_id, student_id) where state = 'in_progress' do nothing;

      select * into a
      from public.test_attempts
      where test_id = p_test_id
        and student_id = v_uid
        and state = 'in_progress';
      if not found then
        raise exception 'attempt_no_mismatch';
      end if;
    end if;
    -- else: a concurrent identical start (double click) created the live
    -- attempt first; this call resumes that same row.

    perform public.finalize_if_expired(a.id);
    select * into a from public.test_attempts where id = a.id;

    if a.state = 'submitted' then
      return jsonb_build_object(
        'already_submitted', true,
        'attempt_id', a.id,
        'started_at', a.started_at,
        'expires_at', a.expires_at,
        'server_now', now(),
        'test_title', t.title
      );
    end if;
    if a.device_id <> p_device_id then
      raise exception 'attempt_locked_other_device';
    end if;
  end if;

  select count(*) into v_attempt_no
  from public.test_attempts x
  where x.test_id = a.test_id
    and x.student_id = a.student_id
    and x.state in ('in_progress', 'submitted')
    and (x.started_at, x.id) <= (a.started_at, a.id);

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
    'attempt_no', v_attempt_no,
    'max_attempts', t.max_attempts,
    'started_at', a.started_at,
    'expires_at', a.expires_at,
    'server_now', now(),
    'test_title', t.title,
    'questions', coalesce(v_questions, '[]'::jsonb),
    'answers', v_answers
  );
end;
$$;

comment on function public.start_attempt(uuid, uuid, int) is
  'Start, resume or reattempt. p_attempt_no = counted-attempt number the caller intends (null = legacy/first). Live in_progress attempt resumes (same device). max_attempts=1: prior submitted raises already_submitted. max_attempts>1: attempt_limit_reached / attempt_no_mismatch / already_submitted(null no.). Counts are re-read under tests FOR UPDATE before INSERT; the pre-lock decision uses a single-snapshot read and never rejects when a concurrent start has created the live attempt.';

revoke execute on function public.start_attempt(uuid, uuid, int) from public, anon;
grant execute on function public.start_attempt(uuid, uuid, int) to authenticated, service_role;

