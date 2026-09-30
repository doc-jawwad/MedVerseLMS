-- MCQ Bank folder practice progress hydration:
-- Canonical progress subject_id for questions remains questions.subject_id
-- (departmental Question Bank taxonomy). Writes already store that key.
-- Students have no direct SELECT on questions, so the client wrongly fell
-- back to mcq_bank_folders.academic_product_subject_id for get_practice_progress,
-- which returned empty after reload.
--
-- Fix:
-- 1) Return subject_id from get_practice_batch so the client hydrates with
--    the same departmental ids the write RPCs store.
-- 2) Allow set_practice_item_* for folder-placed questions when the student
--    has practice access on the folder's product subject (still store
--    questions.subject_id).

-- ---------------------------------------------------------------------------
-- 1. Access helper for question practice progress writes
-- ---------------------------------------------------------------------------
create or replace function public.can_set_question_practice_progress(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.questions q
    left join public.mcq_bank_folders f
      on f.id = q.mcq_bank_folder_id
     and f.deleted_at is null
    where q.id = p_question_id
      and q.status = 'approved'
      and q.deleted_at is null
      and (
        public.has_practice_access(q.subject_id)
        or (
          f.id is not null
          and public.has_active_enrollment(f.year_id)
          and public.has_practice_access(f.academic_product_subject_id)
        )
      )
  );
$$;

comment on function public.can_set_question_practice_progress(uuid) is
  'True when caller may write practice_progress for an approved question via departmental practice access or live MCQ Bank folder product-subject access. Progress subject_id remains questions.subject_id.';

revoke execute on function public.can_set_question_practice_progress(uuid)
  from public, anon;
grant execute on function public.can_set_question_practice_progress(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. set_practice_item_state / marked — folder access + departmental subject_id
-- ---------------------------------------------------------------------------
create or replace function public.set_practice_item_state(
  p_item_kind text,
  p_item_id uuid,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_item_kind not in ('question', 'pearl', 'ospe') then
    raise exception 'invalid_item_kind';
  end if;
  if p_state not in ('remaining', 'done') then
    raise exception 'invalid_state';
  end if;

  if p_item_kind = 'question' then
    select q.subject_id into v_subject
    from public.questions q
    where q.id = p_item_id
      and q.status = 'approved'
      and q.deleted_at is null;
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.can_set_question_practice_progress(p_item_id) then
      raise exception 'practice_access_denied';
    end if;
  elsif p_item_kind = 'pearl' then
    select pp.subject_id into v_subject
    from public.pearl_points pp
    where pp.id = p_item_id and pp.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.has_practice_access(v_subject) then
      raise exception 'practice_access_denied';
    end if;
  else
    select s.subject_id into v_subject
    from public.ospe_stations s
    where s.id = p_item_id and s.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.can_access_ospe_station(p_item_id) then
      raise exception 'practice_access_denied';
    end if;
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, p_state, false, v_subject
  )
  on conflict (student_id, item_kind, item_id) do update
  set state = excluded.state,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_practice_item_state(text, uuid, text)
  from public, anon;
grant execute on function public.set_practice_item_state(text, uuid, text)
  to authenticated, service_role;

create or replace function public.set_practice_item_marked(
  p_item_kind text,
  p_item_id uuid,
  p_marked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_item_kind not in ('question', 'pearl', 'ospe') then
    raise exception 'invalid_item_kind';
  end if;

  if p_item_kind = 'question' then
    select q.subject_id into v_subject
    from public.questions q
    where q.id = p_item_id
      and q.status = 'approved'
      and q.deleted_at is null;
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.can_set_question_practice_progress(p_item_id) then
      raise exception 'practice_access_denied';
    end if;
  elsif p_item_kind = 'pearl' then
    select pp.subject_id into v_subject
    from public.pearl_points pp
    where pp.id = p_item_id and pp.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.has_practice_access(v_subject) then
      raise exception 'practice_access_denied';
    end if;
  else
    select s.subject_id into v_subject
    from public.ospe_stations s
    where s.id = p_item_id and s.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.can_access_ospe_station(p_item_id) then
      raise exception 'practice_access_denied';
    end if;
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, 'remaining', coalesce(p_marked, false), v_subject
  )
  on conflict (student_id, item_kind, item_id) do update
  set marked = excluded.marked,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_practice_item_marked(text, uuid, boolean)
  from public, anon;
grant execute on function public.set_practice_item_marked(text, uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. get_practice_batch — include departmental subject_id (OUT column change)
-- ---------------------------------------------------------------------------
drop function if exists public.get_practice_batch(text, uuid, int);

create function public.get_practice_batch(
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

    return query
    with candidates as (
      select q.id, q.current_version_id, q.difficulty, q.subject_id
      from public.questions q
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
  'Practice batches by subject/book/chapter/topic, mcq_bank_folder (product subject entitlement), or prof_session_day. Returns questions.subject_id for practice_progress hydration.';

revoke execute on function public.get_practice_batch(text, uuid, int)
  from public, anon;
grant execute on function public.get_practice_batch(text, uuid, int)
  to authenticated, service_role;
