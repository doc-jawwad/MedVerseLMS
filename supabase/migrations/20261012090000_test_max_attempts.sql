-- Per-test reattempts (docs/test-rules.md "Attempt limit and reattempts",
-- docs/exam-state-machine.md start_attempt, docs/database.md, docs/scoring-rules.md,
-- docs/access-eligibility-analytics.md).
--
-- Backward compatible: tests.max_attempts defaults to 1, so every existing test
-- keeps today's single-attempt behavior and error contract. No attempt rows are
-- modified, deleted or rewritten. Attempt states/transitions are unchanged — a
-- reattempt is a new row entering via start_attempt.
--
-- Rollout / lock notes (shared DB):
--   * ADD COLUMN with a constant default is metadata-only on PG11+ (brief
--     ACCESS EXCLUSIVE on tests). CREATE INDEX on test_attempts blocks writes
--     for the build; DROP INDEX takes a brief ACCESS EXCLUSIVE. Apply in a low
--     traffic window. lock_timeout below makes the migration fail fast instead
--     of queueing behind a long exam transaction.
--   * Rollback is only safe while no test has more than one non-invalidated
--     attempt per student (re-creating test_attempts_one_live would fail
--     otherwise). Roll forward instead once any max_attempts > 1 test has data.

set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. tests.max_attempts (no upper cap; >= 1 only)
-- ---------------------------------------------------------------------------
alter table public.tests
  add column if not exists max_attempts int not null default 1
  constraint tests_max_attempts_chk check (max_attempts >= 1);

comment on column public.tests.max_attempts is
  'Counted attempts (in_progress + submitted; invalidated never count) allowed per student. Default 1. Frozen after publish.';

-- ---------------------------------------------------------------------------
-- 2. Attempt uniqueness: one live attempt -> one in_progress attempt
--    New index first (cannot fail: today at most one non-invalidated row exists
--    per (test, student), so at most one in_progress), then drop the old one.
-- ---------------------------------------------------------------------------
create unique index if not exists test_attempts_one_in_progress
  on public.test_attempts (test_id, student_id)
  where state = 'in_progress';

create index if not exists test_attempts_test_student_idx
  on public.test_attempts (test_id, student_id);

drop index if exists public.test_attempts_one_live;

-- ---------------------------------------------------------------------------
-- 3. Ranked attempt = each student's best submitted attempt per test
--    (score desc, submitted_at asc, id asc). Internal: no client access.
-- ---------------------------------------------------------------------------
create or replace view public.ranked_test_attempts as
select distinct on (a.test_id, a.student_id) a.*
from public.test_attempts a
where a.state = 'submitted'
order by a.test_id, a.student_id, a.score desc nulls last, a.submitted_at asc, a.id asc;

revoke all on public.ranked_test_attempts from public, anon, authenticated;

comment on view public.ranked_test_attempts is
  'Each student''s ranked (best submitted) attempt per test. Used by rank_test and analytics RPCs only; reattempts never add rows to averages/counts.';

-- ---------------------------------------------------------------------------
-- 4. Invalidating a submitted attempt may change the ranked attempt.
--    Trigger covers invalidate_attempt, invalidate_test and account-status
--    dispositions without patching each RBAC-gated function.
-- ---------------------------------------------------------------------------
create or replace function public.test_attempt_invalidated_rank_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rank_dirty_queue (test_id) values (new.test_id);
  return new;
end;
$$;

revoke execute on function public.test_attempt_invalidated_rank_dirty() from public, anon, authenticated;

drop trigger if exists test_attempts_invalidated_rank_dirty on public.test_attempts;
create trigger test_attempts_invalidated_rank_dirty
  after update of state on public.test_attempts
  for each row
  when (old.state = 'submitted' and new.state = 'invalidated')
  execute function public.test_attempt_invalidated_rank_dirty();

-- ---------------------------------------------------------------------------
-- 5. max_attempts is published-test config: frozen after publish; copied on reuse
-- ---------------------------------------------------------------------------
create or replace function public.protect_published_test()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if new.title is distinct from old.title
       or new.year_id is distinct from old.year_id
       or new.subject_id is distinct from old.subject_id
       or new.opens_at is distinct from old.opens_at
       or new.duration_minutes is distinct from old.duration_minutes
       or new.marks_per_question is distinct from old.marks_per_question
       or new.negative_mark is distinct from old.negative_mark
       or new.shuffle_questions is distinct from old.shuffle_questions
       or new.shuffle_options is distinct from old.shuffle_options
       or new.min_questions is distinct from old.min_questions
       or new.max_attempts is distinct from old.max_attempts
       or new.test_type is distinct from old.test_type
       or new.syllabus is distinct from old.syllabus then
      raise exception 'published test config is frozen (docs/test-rules.md)';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.reuse_test_as_draft(p_source_test_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.tests%rowtype;
  v_new_id uuid;
  v_uid uuid := (select auth.uid());
  v_title text;
begin
  perform public.require_permission('publish_tests');

  if p_source_test_id is null then
    raise exception 'test_not_found';
  end if;

  select * into v_src
  from public.tests t
  where t.id = p_source_test_id
  for update;

  if not found then
    raise exception 'test_not_found';
  end if;

  if v_src.status not in ('published', 'closed') then
    raise exception 'test_not_reusable';
  end if;

  if v_src.closes_at is null or v_src.closes_at > now() then
    raise exception 'test_window_not_closed';
  end if;

  v_title := left(v_src.title || ' (copy)', 200);

  insert into public.tests (
    title, year_id, subject_id, status,
    opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark,
    shuffle_questions, shuffle_options, show_review, min_questions, max_attempts,
    test_type, entitlement, required_plan_id, syllabus,
    prof_session_day_id, created_by
  ) values (
    v_title, v_src.year_id, v_src.subject_id, 'draft',
    null, null,
    v_src.duration_minutes, v_src.marks_per_question, v_src.negative_mark,
    v_src.shuffle_questions, v_src.shuffle_options, v_src.show_review, v_src.min_questions,
    v_src.max_attempts,
    v_src.test_type, v_src.entitlement, v_src.required_plan_id, v_src.syllabus,
    v_src.prof_session_day_id, v_uid
  )
  returning id into v_new_id;

  insert into public.test_questions (
    test_id, question_id, question_version_id, position, marks, voided, void_policy
  )
  select
    v_new_id, tq.question_id, null, tq.position, tq.marks, false, null
  from public.test_questions tq
  where tq.test_id = p_source_test_id
  order by tq.position;

  insert into public.test_audiences (test_id, year_id)
  select v_new_id, a.year_id
  from public.test_audiences a
  where a.test_id = p_source_test_id;

  insert into public.test_prep_guidelines (test_id, body_text)
  select v_new_id, g.body_text
  from public.test_prep_guidelines g
  where g.test_id = p_source_test_id;

  perform public.log_audit(
    'test_reused_as_draft',
    'test',
    v_new_id,
    jsonb_build_object(
      'source_test_id', p_source_test_id,
      'source_title', v_src.title,
      'new_title', v_title
    )
  );

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. rank_test: one row per student (the ranked attempt). Formula unchanged.
--    Non-ranked submitted attempts keep their score but store null rank/percentile.
-- ---------------------------------------------------------------------------
create or replace function public.rank_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  select count(*) into n from public.ranked_test_attempts
  where test_id = p_test_id;

  with ranked as (
    select id,
      rank() over (order by score desc, submitted_at asc) as r
    from public.ranked_test_attempts
    where test_id = p_test_id
  )
  update public.test_attempts a
  set rank = ranked.r,
      percentile = case when n > 1
        then round(100.0 * (n - ranked.r) / (n - 1), 2)
        else null
      end
  from ranked
  where a.id = ranked.id;

  with keep as (
    select id from public.ranked_test_attempts where test_id = p_test_id
  )
  update public.test_attempts a
  set rank = null,
      percentile = null
  where a.test_id = p_test_id
    and a.state = 'submitted'
    and (a.rank is not null or a.percentile is not null)
    and not exists (select 1 from keep k where k.id = a.id);
end;
$$;

revoke execute on function public.rank_test(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. start_attempt with attempt numbering / limit / concurrency contract
-- ---------------------------------------------------------------------------
create or replace function public.attempt_start_decision(
  p_max_attempts int,
  p_counted int,
  p_attempt_no int
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_max_attempts <= 1 then
      case when p_counted >= 1 then 'already_submitted' else 'new' end
    when p_counted = 0 and coalesce(p_attempt_no, 1) = 1 then 'new'
    when p_counted >= 1 and p_attempt_no is null then 'already_submitted'
    when p_counted >= p_max_attempts then 'attempt_limit_reached'
    when p_attempt_no = p_counted + 1 then 'new'
    else 'attempt_no_mismatch'
  end;
$$;

revoke execute on function public.attempt_start_decision(int, int, int) from public, anon, authenticated;

drop function if exists public.start_attempt(uuid, uuid);

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
      select count(*) into v_counted
      from public.test_attempts
      where test_id = p_test_id
        and student_id = v_uid
        and state in ('in_progress', 'submitted');
      v_decision := public.attempt_start_decision(t.max_attempts, v_counted, p_attempt_no);
      if v_decision <> 'new' then
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
  'Start, resume or reattempt. p_attempt_no = counted-attempt number the caller intends (null = legacy/first). Live in_progress attempt resumes (same device). max_attempts=1: prior submitted raises already_submitted. max_attempts>1: attempt_limit_reached / attempt_no_mismatch / already_submitted(null no.). Counts are re-read under tests FOR UPDATE before INSERT.';

revoke execute on function public.start_attempt(uuid, uuid, int) from public, anon;
grant execute on function public.start_attempt(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. get_attempt_review: retake hold while reattempts remain (max_attempts > 1)
--    Same body as 20260919150000 plus the hold between show_review and paid gate.
-- ---------------------------------------------------------------------------
create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  v_allowed boolean;
  v_items jsonb;
  v_admin_review boolean;
  v_used int;
  v_live boolean;
begin
  v_admin_review := public.can_admin_select_attempt_detail();

  -- Student callers require an active LMS account. Permissioned admins retain
  -- review. Live-exam continuation is not this RPC (resume/save/submit only).
  if not v_admin_review and not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into a from public.test_attempts
  where id = p_attempt_id
    and (student_id = (select auth.uid()) or v_admin_review);
  if not found then raise exception 'attempt_not_found'; end if;
  if a.state <> 'submitted' then raise exception 'attempt_not_submitted'; end if;

  select * into t from public.tests where id = a.test_id;

  v_allowed := v_admin_review
    or t.show_review = 'after_submit'
    or (t.show_review = 'after_close' and now() >= t.closes_at);

  if not v_allowed then
    return jsonb_build_object(
      'allowed', false,
      'reason', case t.show_review
        when 'never' then 'review_disabled'
        else 'available_after_close'
      end,
      'closes_at', t.closes_at
    );
  end if;

  -- Answer-key safety: while reattempts remain on a multi-attempt test, do not
  -- reveal review content to students until attempts are exhausted (limit
  -- reached and nothing in progress) or the test closes. Admins unaffected.
  if not v_admin_review and t.max_attempts > 1 and now() < t.closes_at then
    select count(*) filter (where state in ('in_progress', 'submitted')),
           coalesce(bool_or(state = 'in_progress'), false)
    into v_used, v_live
    from public.test_attempts
    where test_id = a.test_id and student_id = a.student_id;

    if v_used < t.max_attempts or v_live then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'available_after_attempts',
        'closes_at', t.closes_at,
        'attempts_used', v_used,
        'max_attempts', t.max_attempts
      );
    end if;
  end if;

  -- Paid / plan resources require live content entitlement. Free tests keep
  -- existing show_review-only rules. Permissioned admins keep review access.
  if not v_admin_review
     and coalesce(t.entitlement, 'free') <> 'free'
     and not public.resource_content_allowed(
       'test', null, t.id, null, t.entitlement, t.required_plan_id
     ) then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'review_locked_entitlement'
    );
  end if;

  select jsonb_agg(item order by (item ->> 'idx')::int) into v_items
  from (
    select jsonb_build_object(
      'idx', ord.idx,
      'stem', qv.stem,
      'options', qv.options,
      'correct_key', trim(qv.correct_key::text),
      'explanation', qv.explanation,
      'reference', qv.reference,
      'selected_key', trim(ans.selected_key::text),
      'marked_for_review', coalesce(ans.marked_for_review, false),
      'voided', coalesce(tq.voided, false),
      'void_policy', tq.void_policy
    ) as item
    from unnest(a.question_order) with ordinality ord(qv_id, idx)
    join public.question_versions qv on qv.id = ord.qv_id
    left join public.attempt_answers ans
      on ans.attempt_id = a.id and ans.question_version_id = qv.id
    left join public.test_questions tq
      on tq.test_id = a.test_id and tq.question_version_id = qv.id
  ) s;

  return jsonb_build_object('allowed', true, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

comment on function public.get_attempt_review(uuid) is
  'Owner (account_allows_lms) or permissioned-admin review payload (view_students|view_analytics). Students on max_attempts>1 tests get reason available_after_attempts (no items) until attempts are exhausted or the test closes. Paid tests require live resource_content_allowed for students. Blocked student accounts raise account_not_eligible. Denied paid review returns reason review_locked_entitlement with no items.';

-- ---------------------------------------------------------------------------
-- 9. get_own_test_result: ranked (best) attempt + caller's own attempt history
-- ---------------------------------------------------------------------------
create or replace function public.get_own_test_result(p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.test_attempts%rowtype;
  t public.tests%rowtype;
  v_invalidated jsonb;
  v_history jsonb;
  v_used int;
  v_live boolean;
begin
  if v_uid is null then
    return null;
  end if;

  -- Ownership only: caller identity is auth.uid(). No client student_id.
  -- Ranked attempt = best submitted attempt (docs/test-rules.md).
  select * into a
  from public.ranked_test_attempts
  where test_id = p_test_id
    and student_id = v_uid;
  if not found then
    return null;
  end if;

  select * into t from public.tests where id = a.test_id;
  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'invalidated_reason', i.invalidated_reason
      )
      order by i.created_at
    ),
    '[]'::jsonb
  )
  into v_invalidated
  from public.test_attempts i
  where i.test_id = p_test_id
    and i.student_id = v_uid
    and i.state = 'invalidated';

  select count(*) filter (where state in ('in_progress', 'submitted')),
         coalesce(bool_or(state = 'in_progress'), false)
  into v_used, v_live
  from public.test_attempts
  where test_id = p_test_id and student_id = v_uid;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', h.id,
      'attempt_no', h.attempt_no,
      'state', h.state,
      'started_at', h.started_at,
      'submitted_at', h.submitted_at,
      'score', h.score,
      'max_score', h.max_score,
      'percentage', h.percentage,
      'is_ranked', h.id = a.id
    ) order by h.attempt_no
  ), '[]'::jsonb)
  into v_history
  from (
    select x.id, x.state, x.started_at, x.submitted_at, x.score, x.max_score, x.percentage,
           row_number() over (order by x.started_at, x.id) as attempt_no
    from public.test_attempts x
    where x.test_id = p_test_id and x.student_id = v_uid
  ) h;

  return jsonb_build_object(
    'test', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'closes_at', t.closes_at,
      'show_review', t.show_review,
      'negative_mark', t.negative_mark,
      'max_attempts', t.max_attempts
    ),
    'attempt', jsonb_build_object(
      'id', a.id,
      'state', a.state,
      'score', a.score,
      'max_score', a.max_score,
      'raw_correct', a.raw_correct,
      'raw_wrong', a.raw_wrong,
      'raw_blank', a.raw_blank,
      'percentage', a.percentage,
      'rank', a.rank,
      'percentile', a.percentile,
      'submitted_at', a.submitted_at,
      'submit_source', a.submit_source
    ),
    'attempts_used', v_used,
    'has_in_progress', v_live,
    'attempts', v_history,
    'invalidated', v_invalidated
  );
end;
$$;

comment on function public.get_own_test_result(uuid) is
  'Caller-owned ranked (best submitted) result summary + own attempt history (auth.uid()). Ignores current catalog/entitlement/year. No review items.';

-- ---------------------------------------------------------------------------
-- 10. Leaderboard + student analytics: one row per (student, test)
-- ---------------------------------------------------------------------------
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
  from public.ranked_test_attempts a
  join public.profiles p on p.id = a.student_id
  where a.test_id = p_test_id
    and (
      public.can_access_test(p_test_id)
      or public.has_permission('view_analytics')
      or public.has_permission('view_students')
      or public.has_permission('publish_tests')
    )
  order by a.rank asc nulls last;
$$;

create or replace function public.student_test_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tests_taken', count(*),
    'average_percentage', round(coalesce(avg(percentage), 0), 2),
    'best_percentage', coalesce(max(percentage), 0),
    'average_rank', round(coalesce(avg(rank), 0), 1)
  )
  from public.ranked_test_attempts
  where student_id = (select auth.uid());
$$;

create or replace function public.student_recent_tests(p_limit int default 5)
returns table (
  test_id uuid,
  title text,
  score numeric,
  max_score numeric,
  percentage numeric,
  rank int,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.test_id, t.title, a.score, a.max_score, a.percentage, a.rank, a.submitted_at
  from public.ranked_test_attempts a
  join public.tests t on t.id = a.test_id
  where a.student_id = (select auth.uid())
  order by a.submitted_at desc
  limit greatest(1, least(p_limit, 50));
$$;

create or replace function public.student_trend()
returns table (
  test_id uuid,
  title text,
  percentage numeric,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.test_id, t.title, a.percentage, a.submitted_at
  from public.ranked_test_attempts a
  join public.tests t on t.id = a.test_id
  where a.student_id = (select auth.uid())
  order by a.submitted_at asc;
$$;

create or replace function public.student_subject_performance()
returns table (
  subject_id uuid,
  subject_name text,
  test_average_percentage numeric,
  tests_taken bigint,
  practice_accuracy numeric,
  practice_answered bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with test_perf as (
    select t.subject_id,
      round(coalesce(avg(a.percentage), 0), 2) as avg_pct,
      count(distinct a.id) as n_tests
    from public.tests t
    join public.ranked_test_attempts a
      on a.test_id = t.id and a.student_id = (select auth.uid())
    group by t.subject_id
  ),
  practice_perf as (
    select pa.subject_id,
      round(coalesce(100.0 * sum((pa.is_correct)::int) / nullif(count(pa.id), 0), 0), 2) as accuracy,
      count(pa.id) as n_answered
    from public.practice_answers pa
    where pa.student_id = (select auth.uid())
    group by pa.subject_id
  )
  select
    s.id,
    s.name,
    coalesce(tp.avg_pct, 0),
    coalesce(tp.n_tests, 0),
    coalesce(pp.accuracy, 0),
    coalesce(pp.n_answered, 0)
  from public.subjects s
  join public.enrollments e
    on e.year_id = s.year_id and e.student_id = (select auth.uid()) and e.status = 'active'
  left join test_perf tp on tp.subject_id = s.id
  left join practice_perf pp on pp.subject_id = s.id
  order by s.sort_order, s.name;
$$;

-- ---------------------------------------------------------------------------
-- 11. Admin analytics: patch the CURRENT definitions in place so the RBAC gates
--     installed by 20260915033122_admin_permissions.sql are preserved
--     (same pg_get_functiondef technique as _medverse_replace_admin_gate).
--     Each patch must change the definition or the migration aborts.
-- ---------------------------------------------------------------------------
do $patch$
declare
  def text;
  patched text;
begin
  -- test_summary: attempted/completed count distinct students; stats use the
  -- ranked attempt only.
  def := pg_get_functiondef('public.test_summary(uuid)'::regprocedure);
  patched := regexp_replace(
    def,
    'select count\(\*\) filter \(where state in \(''in_progress'', ''submitted''\)\),.*?from public\.test_attempts[[:space:]]+where test_id = p_test_id;',
    'select count(distinct student_id) filter (where state in (''in_progress'', ''submitted'')), count(distinct student_id) filter (where state = ''submitted'') into v_attempted, v_completed from public.test_attempts where test_id = p_test_id; select avg(score), percentile_cont(0.5) within group (order by score), max(score), min(score) into v_avg, v_median, v_max, v_min from public.ranked_test_attempts where test_id = p_test_id;'
  );
  if patched is not distinct from def then
    raise exception 'max_attempts patch missed for test_summary';
  end if;
  execute patched;

  -- admin_platform_summary: ranked attempts only (one row per student per test).
  def := pg_get_functiondef('public.admin_platform_summary()'::regprocedure);
  patched := regexp_replace(
    def,
    'from public\.test_attempts where state = ''submitted'';',
    'from public.ranked_test_attempts;'
  );
  if patched is not distinct from def then
    raise exception 'max_attempts patch missed for admin_platform_summary (totals)';
  end if;
  def := patched;
  patched := regexp_replace(
    def,
    'join public\.test_attempts a on a\.test_id = t\.id and a\.state = ''submitted''',
    'join public.ranked_test_attempts a on a.test_id = t.id'
  );
  if patched is not distinct from def then
    raise exception 'max_attempts patch missed for admin_platform_summary (best subject)';
  end if;
  def := patched;
  patched := regexp_replace(
    def,
    'left join public\.test_attempts a[[:space:]]+on a\.student_id = e\.student_id and a\.state = ''submitted''',
    'left join public.ranked_test_attempts a on a.student_id = e.student_id'
  );
  if patched is not distinct from def then
    raise exception 'max_attempts patch missed for admin_platform_summary (participation)';
  end if;
  execute patched;

  -- admin_student_profile: tests_taken / averages over ranked attempts.
  def := pg_get_functiondef('public.admin_student_profile(uuid)'::regprocedure);
  patched := regexp_replace(
    def,
    'from public\.test_attempts where student_id = p_student_id and state = ''submitted'';',
    'from public.ranked_test_attempts where student_id = p_student_id;'
  );
  if patched is not distinct from def then
    raise exception 'max_attempts patch missed for admin_student_profile';
  end if;
  execute patched;
end;
$patch$;
