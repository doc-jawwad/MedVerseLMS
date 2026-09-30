-- Favorites entitlement seal:
-- Favorites (practice_progress.marked) are NOT an entitlement.
-- Stored marked rows may persist historically, but every Favorites read/practice
-- path MUST re-check current MCQ Bank folder year enrollment + product-subject
-- practice access — the same gates as normal folder practice.
-- Never serve Favorites by "favorite IDs → SELECT questions" without those gates.

-- ---------------------------------------------------------------------------
-- 1. Shared folder practice authorization (folder + favorites + progress + reset)
-- ---------------------------------------------------------------------------
create or replace function public.can_access_mcq_bank_folder_practice(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mcq_bank_folders f
    where f.id = p_folder_id
      and f.deleted_at is null
      and public.has_active_enrollment(f.year_id)
      and public.has_practice_access(f.academic_product_subject_id)
  );
$$;

comment on function public.can_access_mcq_bank_folder_practice(uuid) is
  'True when caller may practice / list progress / practice Favorites for a live MCQ Bank folder: active enrollment on folder.year_id AND has_practice_access on academic_product_subject_id. Favorites marked rows do not grant access.';

revoke execute on function public.can_access_mcq_bank_folder_practice(uuid)
  from public, anon;
grant execute on function public.can_access_mcq_bank_folder_practice(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Folder progress — same gate; favorites count only after authorization
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
  if not exists (
    select 1 from public.mcq_bank_folders f
    where f.id = p_folder_id and f.deleted_at is null
  ) then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  -- Favorites are not entitlement: deny before counting marked rows.
  if not public.can_access_mcq_bank_folder_practice(p_folder_id) then
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
  'Caller-scoped folder progress + favorites count. Requires can_access_mcq_bank_folder_practice. Marked rows alone never grant listing.';

-- ---------------------------------------------------------------------------
-- 3. Folder restart — same gate
-- ---------------------------------------------------------------------------
create or replace function public.reset_mcq_bank_folder_practice(p_folder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reset int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not exists (
    select 1 from public.mcq_bank_folders f
    where f.id = p_folder_id and f.deleted_at is null
  ) then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.can_access_mcq_bank_folder_practice(p_folder_id) then
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
  'Folder Restart (done→remaining). Requires can_access_mcq_bank_folder_practice. Preserves marked Favorites.';

-- ---------------------------------------------------------------------------
-- 4. get_practice_batch — folder + favorites share authorization helper
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
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 100));
begin
  if p_scope_type in ('mcq_bank_folder', 'mcq_bank_folder_favorites') then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;
    if not exists (
      select 1 from public.mcq_bank_folders f
      where f.id = p_scope_id and f.deleted_at is null
    ) then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    -- Favorites are not entitlement. Same gate as normal folder practice.
    if not public.can_access_mcq_bank_folder_practice(p_scope_id) then
      raise exception 'practice_access_denied';
    end if;

    if p_scope_type = 'mcq_bank_folder_favorites' then
      -- Scope = authorized folder first; then filter marked within that folder.
      -- Never: marked IDs → questions without folder/year/entitlement gates.
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
  'Practice batches by subject/book/chapter/topic, mcq_bank_folder, mcq_bank_folder_favorites, or prof_session_day. Favorites scope requires can_access_mcq_bank_folder_practice — marked is not entitlement.';

revoke execute on function public.get_practice_batch(text, uuid, int)
  from public, anon;
grant execute on function public.get_practice_batch(text, uuid, int)
  to authenticated, service_role;

comment on column public.practice_progress.marked is
  'Student Favorites flag. Historical continuity only — never grants MCQ/folder access. Reads/practice must use can_access_mcq_bank_folder_practice / has_practice_access.';
