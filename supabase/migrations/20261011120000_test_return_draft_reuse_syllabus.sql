-- Batch B: optional tests.syllabus; return_to_draft_test; reuse_test_as_draft.
-- Serializes with start_attempt via tests … FOR UPDATE.
-- Does not touch production cron or attempt history.

-- ---------------------------------------------------------------------------
-- 1. Optional syllabus (plain text, bounded)
-- ---------------------------------------------------------------------------
alter table public.tests
  add column if not exists syllabus text;

alter table public.tests
  drop constraint if exists tests_syllabus_length_chk;

alter table public.tests
  add constraint tests_syllabus_length_chk
  check (syllabus is null or char_length(syllabus) <= 8000);

comment on column public.tests.syllabus is
  'Optional plain-text syllabus for students (≤8000 chars). Frozen after publish. Not answer keys.';

-- Freeze syllabus with other published config.
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
       or new.test_type is distinct from old.test_type
       or new.syllabus is distinct from old.syllabus then
      raise exception 'published test config is frozen (docs/test-rules.md)';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. return_to_draft_test — unopened published, zero attempts
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

comment on function public.return_to_draft_test(uuid) is
  'publish_tests: published + opens_at > now() + zero attempts → draft; clears frozen question_version_id.';

revoke execute on function public.return_to_draft_test(uuid) from public, anon;
grant execute on function public.return_to_draft_test(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. reuse_test_as_draft — conducted source → new draft (source unchanged)
-- ---------------------------------------------------------------------------
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
    shuffle_questions, shuffle_options, show_review, min_questions,
    test_type, entitlement, required_plan_id, syllabus,
    prof_session_day_id, created_by
  ) values (
    v_title, v_src.year_id, v_src.subject_id, 'draft',
    null, null,
    v_src.duration_minutes, v_src.marks_per_question, v_src.negative_mark,
    v_src.shuffle_questions, v_src.shuffle_options, v_src.show_review, v_src.min_questions,
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

comment on function public.reuse_test_as_draft(uuid) is
  'publish_tests: copy conducted test into a new unscheduled draft; source unchanged; no attempts/grants.';

revoke execute on function public.reuse_test_as_draft(uuid) from public, anon;
grant execute on function public.reuse_test_as_draft(uuid) to authenticated, service_role;
