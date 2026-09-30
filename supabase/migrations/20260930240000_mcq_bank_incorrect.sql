-- MCQ Bank Incorrect set:
-- Canonical Incorrect cursor is practice_progress.incorrect (student-scoped).
-- Written by submit_practice_answer: wrong → true, correct → false.
-- Independent of state (Done), marked (Favorites), practice_answers history.
-- Incorrect is NOT entitlement — practice/list require can_access_mcq_bank_folder_practice.

-- ---------------------------------------------------------------------------
-- 1. Column + index
-- ---------------------------------------------------------------------------
alter table public.practice_progress
  add column if not exists incorrect boolean not null default false;

create index if not exists practice_progress_student_incorrect_idx
  on public.practice_progress (student_id, incorrect)
  where incorrect = true;

comment on column public.practice_progress.incorrect is
  'Student Incorrect-MCQ cursor. Set by submit_practice_answer (wrong=true, correct=false). Independent of state/marked. Never grants access — use can_access_mcq_bank_folder_practice.';

comment on table public.practice_progress is
  'Practice Done/Favorites/Incorrect cursor. Not test_attempts. Independent of practice_answers history.';

-- ---------------------------------------------------------------------------
-- 2. submit_practice_answer — upsert Incorrect cursor
-- ---------------------------------------------------------------------------
create or replace function public.submit_practice_answer(
  p_question_version_id uuid,
  p_selected_key char
)
returns table (
  is_correct boolean,
  correct_key char,
  explanation text,
  reference text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_version public.question_versions%rowtype;
  v_question public.questions%rowtype;
  v_correct boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_version from public.question_versions where id = p_question_version_id;
  if not found then
    raise exception 'question version not found';
  end if;
  select * into v_question from public.questions where id = v_version.question_id;
  if not found or v_question.status is distinct from 'approved' or v_question.deleted_at is not null then
    raise exception 'question version not found';
  end if;

  -- Same access helper as practice_progress writes (folder product OR departmental).
  if not public.can_set_question_practice_progress(v_question.id) then
    raise exception 'practice_access_denied';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_version.options) o
    where o ->> 'key' = p_selected_key::text
  ) then
    raise exception 'invalid option %', p_selected_key;
  end if;

  v_correct := (p_selected_key = v_version.correct_key);

  insert into public.practice_answers
    (student_id, question_version_id, selected_key, is_correct, subject_id, chapter_id, topic_id)
  values
    (v_uid, p_question_version_id, p_selected_key, v_correct,
     v_question.subject_id, v_question.chapter_id, v_question.topic_id);

  -- Incorrect cursor: wrong answers enter; correct answers leave. Preserve Done/Favorites.
  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, incorrect, subject_id
  ) values (
    v_uid, 'question', v_question.id, 'remaining', false, (not v_correct), v_question.subject_id
  )
  on conflict (student_id, item_kind, item_id) do update
  set incorrect = excluded.incorrect,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);

  return query select v_correct, v_version.correct_key, v_version.explanation, v_version.reference;
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

comment on function public.submit_practice_answer(uuid, char) is
  'Append practice_answers and set practice_progress.incorrect from is_correct. Does not change Done/Favorites. Access via can_set_question_practice_progress.';

revoke execute on function public.submit_practice_answer(uuid, char)
  from public, anon;
grant execute on function public.submit_practice_answer(uuid, char)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. set_practice_item_state / marked — preserve incorrect
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
    student_id, item_kind, item_id, state, marked, incorrect, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, p_state, false, false, v_subject
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
    student_id, item_kind, item_id, state, marked, incorrect, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, 'remaining', coalesce(p_marked, false), false, v_subject
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

comment on function public.set_practice_item_marked(text, uuid, boolean) is
  'Set Favorites (marked) for the caller only. Does not change state/Done, incorrect, practice_answers, or practice_seen.';

revoke execute on function public.set_practice_item_marked(text, uuid, boolean)
  from public, anon;
grant execute on function public.set_practice_item_marked(text, uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. get_practice_progress — include incorrect on items
-- ---------------------------------------------------------------------------
create or replace function public.get_practice_progress(p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_total int;
  v_done int;
  v_marked int;
  v_incorrect int;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if not public.can_view_practice_subject(p_subject_id) then
    raise exception 'practice_subject_not_visible';
  end if;

  select count(*)::int into v_total
  from public.questions q
  where q.subject_id = p_subject_id and q.status = 'approved';

  select
    count(*) filter (where pp.state = 'done')::int,
    count(*) filter (where pp.marked)::int,
    count(*) filter (where pp.incorrect)::int
  into v_done, v_marked, v_incorrect
  from public.practice_progress pp
  where pp.student_id = v_uid
    and pp.subject_id = p_subject_id
    and pp.item_kind = 'question';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_kind', pp.item_kind,
      'item_id', pp.item_id,
      'state', pp.state,
      'marked', pp.marked,
      'incorrect', pp.incorrect
    )
    order by pp.updated_at desc
  ), '[]'::jsonb)
  into v_items
  from public.practice_progress pp
  where pp.student_id = v_uid
    and pp.subject_id = p_subject_id;

  return jsonb_build_object(
    'subject_id', p_subject_id,
    'total', v_total,
    'done', coalesce(v_done, 0),
    'remaining', greatest(v_total - coalesce(v_done, 0), 0),
    'marked', coalesce(v_marked, 0),
    'incorrect', coalesce(v_incorrect, 0),
    'percent_complete', case
      when v_total > 0 then round(100.0 * coalesce(v_done, 0) / v_total, 1)
      else 0
    end,
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_practice_progress(uuid) from public, anon;
grant execute on function public.get_practice_progress(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Folder progress — incorrect count (after entitlement gate)
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
  v_incorrect bigint;
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

  select count(*) into v_incorrect
  from public.questions q
  join public.practice_progress pp
    on pp.item_id = q.id
   and pp.student_id = v_uid
   and pp.item_kind = 'question'
   and pp.incorrect = true
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
    'favorites', v_favorites,
    'incorrect', v_incorrect
  );
end;
$$;

comment on function public.get_mcq_bank_folder_practice_progress(uuid) is
  'Caller-scoped folder progress + favorites + incorrect counts. Requires can_access_mcq_bank_folder_practice. Marked/incorrect rows alone never grant listing.';

-- ---------------------------------------------------------------------------
-- 6. get_practice_batch — mcq_bank_folder_incorrect scope
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
  if p_scope_type in (
    'mcq_bank_folder',
    'mcq_bank_folder_favorites',
    'mcq_bank_folder_incorrect'
  ) then
    if (select auth.uid()) is null then
      raise exception 'not_authenticated';
    end if;
    if not exists (
      select 1 from public.mcq_bank_folders f
      where f.id = p_scope_id and f.deleted_at is null
    ) then
      raise exception 'mcq_bank_folder_not_found';
    end if;
    -- Favorites/Incorrect are not entitlement. Same gate as normal folder practice.
    if not public.can_access_mcq_bank_folder_practice(p_scope_id) then
      raise exception 'practice_access_denied';
    end if;

    if p_scope_type = 'mcq_bank_folder_favorites' then
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

    if p_scope_type = 'mcq_bank_folder_incorrect' then
      -- Authorized folder first; then incorrect=true within that folder.
      return query
      with candidates as (
        select q.id, q.current_version_id, q.difficulty, q.subject_id
        from public.questions q
        join public.practice_progress pp
          on pp.item_id = q.id
         and pp.student_id = (select auth.uid())
         and pp.item_kind = 'question'
         and pp.incorrect = true
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
  'Practice batches by subject/book/chapter/topic, mcq_bank_folder, mcq_bank_folder_favorites, mcq_bank_folder_incorrect, or prof_session_day. Favorites/Incorrect require can_access_mcq_bank_folder_practice — those flags are not entitlement.';

revoke execute on function public.get_practice_batch(text, uuid, int)
  from public, anon;
grant execute on function public.get_practice_batch(text, uuid, int)
  to authenticated, service_role;

comment on function public.reset_mcq_bank_folder_practice(uuid) is
  'Folder Restart (done→remaining). Requires can_access_mcq_bank_folder_practice. Preserves marked Favorites and incorrect cursor.';
