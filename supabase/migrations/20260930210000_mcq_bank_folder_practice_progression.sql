-- MCQ Bank folder practice progression:
-- 1) Folder-level completed/total progress (student-scoped, practice_progress)
-- 2) Undone-first get_practice_batch for mcq_bank_folder
-- 3) Folder-scoped restart (done → remaining; marked/answers/seen preserved)
-- Does not invent a second progress system. Production untouched by this file alone.

-- ---------------------------------------------------------------------------
-- 1. Single-folder progress summary
-- ---------------------------------------------------------------------------
create or replace function public.get_mcq_bank_folder_practice_progress(p_folder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_folder public.mcq_bank_folders%rowtype;
  v_total bigint;
  v_done bigint;
  v_remaining bigint;
  v_percent int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_folder
  from public.mcq_bank_folders
  where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.has_active_enrollment(v_folder.year_id) then
    raise exception 'practice_access_denied';
  end if;
  if not public.has_practice_access(v_folder.academic_product_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  select count(*) into v_total
  from public.questions q
  where q.mcq_bank_folder_id = p_folder_id
    and q.status = 'approved'
    and q.deleted_at is null;

  select count(*) into v_done
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.state = 'done'
  where q.mcq_bank_folder_id = p_folder_id
    and q.status = 'approved'
    and q.deleted_at is null;

  v_remaining := greatest(v_total - v_done, 0);
  if v_total <= 0 or v_done <= 0 then
    v_percent := 0;
  else
    v_percent := round((100.0 * least(v_done, v_total)) / v_total)::int;
  end if;

  return jsonb_build_object(
    'folder_id', p_folder_id,
    'total', v_total,
    'done', v_done,
    'remaining', v_remaining,
    'percent_complete', v_percent,
    'complete', (v_total > 0 and v_done >= v_total)
  );
end;
$$;

comment on function public.get_mcq_bank_folder_practice_progress(uuid) is
  'Caller-scoped MCQ Bank folder progress: done/total from practice_progress.state=done on approved folder questions. Entitlement via product subject.';

revoke execute on function public.get_mcq_bank_folder_practice_progress(uuid)
  from public, anon;
grant execute on function public.get_mcq_bank_folder_practice_progress(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Product-subject folder progress list (hub; one round-trip)
-- ---------------------------------------------------------------------------
create or replace function public.list_mcq_bank_folder_practice_progress(
  p_product_subject_id uuid
)
returns table (
  folder_id uuid,
  name text,
  sort_order int,
  total bigint,
  done bigint,
  remaining bigint,
  percent_complete int,
  complete boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select year_id into v_year from public.subjects where id = p_product_subject_id;
  if v_year is null then
    raise exception 'product_subject_not_found';
  end if;
  if not public.has_active_enrollment(v_year) then
    raise exception 'practice_access_denied';
  end if;
  if not public.has_practice_access(p_product_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  return query
  select
    f.id,
    f.name,
    f.sort_order,
    coalesce(t.total, 0)::bigint,
    coalesce(t.done, 0)::bigint,
    greatest(coalesce(t.total, 0) - coalesce(t.done, 0), 0)::bigint,
    case
      when coalesce(t.total, 0) <= 0 or coalesce(t.done, 0) <= 0 then 0
      else round((100.0 * least(t.done, t.total)) / t.total)::int
    end,
    (coalesce(t.total, 0) > 0 and coalesce(t.done, 0) >= t.total)
  from public.mcq_bank_folders f
  left join lateral (
    select
      count(*)::bigint as total,
      count(*) filter (
        where exists (
          select 1
          from public.practice_progress pp
          where pp.student_id = v_uid
            and pp.item_kind = 'question'
            and pp.item_id = q.id
            and pp.state = 'done'
        )
      )::bigint as done
    from public.questions q
    where q.mcq_bank_folder_id = f.id
      and q.status = 'approved'
      and q.deleted_at is null
  ) t on true
  where f.academic_product_subject_id = p_product_subject_id
    and f.deleted_at is null
  order by f.sort_order, f.name, f.id;
end;
$$;

comment on function public.list_mcq_bank_folder_practice_progress(uuid) is
  'Caller-scoped progress for all live MCQ Bank folders under a product subject. One query for the folder hub.';

revoke execute on function public.list_mcq_bank_folder_practice_progress(uuid)
  from public, anon;
grant execute on function public.list_mcq_bank_folder_practice_progress(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Folder-scoped restart (done → remaining for questions in this folder only)
-- ---------------------------------------------------------------------------
create or replace function public.reset_mcq_bank_folder_practice(p_folder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_folder public.mcq_bank_folders%rowtype;
  v_reset int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_folder
  from public.mcq_bank_folders
  where id = p_folder_id and deleted_at is null;
  if not found then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.has_active_enrollment(v_folder.year_id) then
    raise exception 'practice_access_denied';
  end if;
  if not public.has_practice_access(v_folder.academic_product_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  update public.practice_progress pp
  set state = 'remaining',
      updated_at = now()
  where pp.student_id = v_uid
    and pp.item_kind = 'question'
    and pp.state = 'done'
    and exists (
      select 1
      from public.questions q
      where q.id = pp.item_id
        and q.mcq_bank_folder_id = p_folder_id
        and q.status = 'approved'
        and q.deleted_at is null
    );
  get diagnostics v_reset = row_count;
  perform set_config('medverse.practice_progress_rpc', '', true);

  -- marked preserved; practice_answers / practice_seen / sessions untouched
  return jsonb_build_object(
    'folder_id', p_folder_id,
    'reset_count', v_reset
  );
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

comment on function public.reset_mcq_bank_folder_practice(uuid) is
  'Explicit folder Restart: sets practice_progress.state done→remaining for caller questions in this folder only. Preserves marked, practice_answers, practice_seen.';

revoke execute on function public.reset_mcq_bank_folder_practice(uuid)
  from public, anon;
grant execute on function public.reset_mcq_bank_folder_practice(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Undone-first batch selection for mcq_bank_folder
-- ---------------------------------------------------------------------------
create or replace function public.get_practice_batch(
  p_scope_type text,
  p_scope_id uuid,
  p_limit int default 10
)
returns table (
  question_id uuid,
  question_version_id uuid,
  stem text,
  options jsonb,
  difficulty text,
  subject_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_subject_id uuid;
  v_day public.prof_session_days%rowtype;
  v_folder public.mcq_bank_folders%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 100));
begin
  if p_scope_type = 'mcq_bank_folder' then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;

    select * into v_folder
    from public.mcq_bank_folders
    where id = p_scope_id and deleted_at is null;
    if not found then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    if not public.has_active_enrollment(v_folder.year_id) then
      raise exception 'practice_access_denied';
    end if;
    if not public.has_practice_access(v_folder.academic_product_subject_id) then
      raise exception 'practice_access_denied';
    end if;

    -- Undone-first: only remaining (or no progress row). When folder is 100%
    -- done, return empty — do not silently re-serve completed MCQs.
    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty, q.subject_id
      from public.questions q
      left join public.practice_progress pp
        on pp.item_id = q.id
       and pp.student_id = (select auth.uid())
       and pp.item_kind = 'question'
      where q.mcq_bank_folder_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
        and coalesce(pp.state, 'remaining') = 'remaining'
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.subject_id
      from candidates c
      left join public.practice_seen s
        on s.question_id = c.id and s.student_id = (select auth.uid())
      order by coalesce(s.cycle, 0) asc, random()
      limit greatest(1, least(p_limit, 50))
    ),
    marked as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked m on m.question_id = p.id;

    return;
  end if;

  if p_scope_type = 'prof_session_day' then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;

    select * into v_day from public.prof_session_days where id = p_scope_id;
    if not found or v_day.deleted_at is not null then
      raise exception 'day_not_found';
    end if;
    if v_day.status is distinct from 'published' then
      raise exception 'day_not_published';
    end if;
    if v_day.subject_id is null then
      raise exception 'subject_id_required';
    end if;
    if not public.has_active_enrollment(v_day.year_id) then
      raise exception 'practice_access_denied';
    end if;
    if not public.has_live_subscription() then
      raise exception 'practice_access_denied';
    end if;

    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty, q.subject_id, pq.sort_order
      from public.prof_session_day_practice_questions pq
      join public.questions q on q.id = pq.question_id
      where pq.day_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.subject_id, c.sort_order
      from candidates c
      left join public.practice_seen s
        on s.question_id = c.id and s.student_id = (select auth.uid())
      order by c.sort_order asc, coalesce(s.cycle, 0) asc, c.id
      limit v_limit
    ),
    marked as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked m on m.question_id = p.id
    order by p.sort_order, p.id;

    return;
  end if;

  if p_scope_type not in ('subject', 'book', 'chapter', 'topic') then
    raise exception 'invalid scope type %', p_scope_type;
  end if;

  v_subject_id := case p_scope_type
    when 'subject' then p_scope_id
    when 'book' then (select subject_id from public.books where id = p_scope_id)
    when 'chapter' then (select subject_id from public.chapters where id = p_scope_id)
    when 'topic' then (select subject_id from public.topics where id = p_scope_id)
  end;

  if v_subject_id is null or not public.has_practice_access(v_subject_id) then
    raise exception 'practice_access_denied';
  end if;

  return query
  with candidates as (
    select q.id, q.current_version_id, q.difficulty, q.subject_id
    from public.questions q
    where q.status = 'approved'
      and q.deleted_at is null
      and case p_scope_type
        when 'subject' then q.subject_id = p_scope_id
        when 'book' then q.book_id = p_scope_id
        when 'chapter' then q.chapter_id = p_scope_id
        when 'topic' then q.topic_id = p_scope_id
      end
  ),
  picked as (
    select c.id, c.current_version_id, c.difficulty, c.subject_id
    from candidates c
    left join public.practice_seen s
      on s.question_id = c.id and s.student_id = (select auth.uid())
    order by coalesce(s.cycle, 0) asc, random()
    limit greatest(1, least(p_limit, 50))
  ),
  marked as (
    insert into public.practice_seen (student_id, question_id)
    select (select auth.uid()), p.id from picked p
    on conflict (student_id, question_id)
      do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
    returning question_id
  )
  select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
  from picked p
  join public.question_versions v on v.id = p.current_version_id
  join marked m on m.question_id = p.id;
end;
$$;

comment on function public.get_practice_batch(text, uuid, int) is
  'Practice batches by subject/book/chapter/topic, mcq_bank_folder (undone-first; empty at 100%), or prof_session_day. Returns questions.subject_id for practice_progress hydration.';

revoke execute on function public.get_practice_batch(text, uuid, int)
  from public, anon;
grant execute on function public.get_practice_batch(text, uuid, int)
  to authenticated, service_role;
