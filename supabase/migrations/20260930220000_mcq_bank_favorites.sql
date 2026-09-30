-- MCQ Bank Favorites:
-- Canonical Favorites state is practice_progress.marked (student-scoped).
-- Independent of state (remaining|done), practice_answers, practice_seen, sessions.
-- Product UI: Favorite / Unfavorite; Practice Favorites = marked rows in folder.
-- DB column stays `marked` for compatibility; set_practice_item_marked remains the write RPC.

-- ---------------------------------------------------------------------------
-- 1. Folder progress: include favorites count for hub empty-state
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
  v_favorites bigint;
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

  select count(*) into v_favorites
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.marked = true
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
    'complete', (v_total > 0 and v_done >= v_total),
    'favorites', v_favorites
  );
end;
$$;

comment on function public.get_mcq_bank_folder_practice_progress(uuid) is
  'Caller-scoped MCQ Bank folder progress: done/total + favorites (practice_progress.marked) on approved folder questions. Entitlement via product subject.';

-- ---------------------------------------------------------------------------
-- 2. get_practice_batch — mcq_bank_folder_favorites scope
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
  if p_scope_type in ('mcq_bank_folder', 'mcq_bank_folder_favorites') then
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

    if p_scope_type = 'mcq_bank_folder_favorites' then
      -- Favorites only (marked=true). Includes done + remaining. Empty when none.
      return query
      with candidates as (
        select q.id, q.current_version_id, q.difficulty, q.subject_id
        from public.questions q
        join public.practice_progress pp
          on pp.item_id = q.id
         and pp.student_id = (select auth.uid())
         and pp.item_kind = 'question'
         and pp.marked = true
        where q.mcq_bank_folder_id = p_scope_id
          and q.status = 'approved'
          and q.deleted_at is null
      ),
      picked as (
        select c.id, c.current_version_id, c.difficulty, c.subject_id
        from candidates c
        left join public.practice_seen s
          on s.question_id = c.id and s.student_id = (select auth.uid())
        order by coalesce(s.cycle, 0) asc, random()
        limit greatest(1, least(p_limit, 50))
      ),
      marked_seen as (
        insert into public.practice_seen (student_id, question_id)
        select (select auth.uid()), p.id from picked p
        on conflict (student_id, question_id)
          do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
        returning question_id
      )
      select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
      from picked p
      join public.question_versions v on v.id = p.current_version_id
      join marked_seen m on m.question_id = p.id;

      return;
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
    marked_seen as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked_seen m on m.question_id = p.id;

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
    marked_seen as (
      insert into public.practice_seen (student_id, question_id)
      select (select auth.uid()), p.id from picked p
      on conflict (student_id, question_id)
        do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
      returning question_id
    )
    select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
    from picked p
    join public.question_versions v on v.id = p.current_version_id
    join marked_seen m on m.question_id = p.id
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
  marked_seen as (
    insert into public.practice_seen (student_id, question_id)
    select (select auth.uid()), p.id from picked p
    on conflict (student_id, question_id)
      do update set cycle = practice_seen.cycle + 1, last_seen_at = now()
    returning question_id
  )
  select p.id, v.id, v.stem, v.options, p.difficulty, p.subject_id
  from picked p
  join public.question_versions v on v.id = p.current_version_id
  join marked_seen m on m.question_id = p.id;
end;
$$;

comment on function public.get_practice_batch(text, uuid, int) is
  'Practice batches by subject/book/chapter/topic, mcq_bank_folder (undone-first), mcq_bank_folder_favorites (marked=true only), or prof_session_day. Returns questions.subject_id for practice_progress hydration.';

revoke execute on function public.get_practice_batch(text, uuid, int)
  from public, anon;
grant execute on function public.get_practice_batch(text, uuid, int)
  to authenticated, service_role;

comment on column public.practice_progress.marked is
  'Student Favorites flag (product: Favorite/Unfavorite). Independent of state remaining|done, practice_answers, and practice_seen. Written only via set_practice_item_marked for auth.uid().';

comment on function public.set_practice_item_marked(text, uuid, boolean) is
  'Set Favorites (marked) for the caller only. Does not change state/Done, practice_answers, or practice_seen. Access via can_set_question_practice_progress / pearl / ospe checks.';
