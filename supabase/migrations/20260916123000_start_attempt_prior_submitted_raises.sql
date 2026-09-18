-- Distinguish same-call lazy-finalize from a prior submitted row.
-- Returning already_submitted=true after finalize keeps an auto-submit that
-- happened in THIS transaction. Raising for a row that was already submitted
-- before the call restores the 020 contract (P0001 already_submitted) without
-- rolling back a lazy finalize (there is none).

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

  if not public.is_active_session() then
    raise exception 'session_superseded';
  end if;

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

  select * into a from public.test_attempts where id = v_aid;
  -- Prior submitted: raise so callers (and 020) see P0001 already_submitted.
  -- Do not call finalize — there is nothing to convert, and a raise after
  -- finalize would be pointless because this row is already terminal.
  if a.state = 'submitted' then
    raise exception 'already_submitted';
  end if;

  perform public.finalize_if_expired(v_aid);
  select * into a from public.test_attempts where id = v_aid;

  -- Same-call lazy-finalize: return a flag so the auto-submit commits.
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

comment on function public.start_attempt(uuid, uuid) is
  'Start or resume. Same-call lazy-finalize of expired in_progress returns already_submitted=true. A row that was already submitted before the call raises already_submitted.';

revoke execute on function public.start_attempt(uuid, uuid) from public, anon;
grant execute on function public.start_attempt(uuid, uuid) to authenticated, service_role;
