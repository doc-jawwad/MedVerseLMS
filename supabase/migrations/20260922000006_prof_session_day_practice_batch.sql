-- 20260922000006: Prof. Session day practice batch + one_liner day link helpers
-- Extends get_practice_batch with scope 'prof_session_day' (subscription + published day).
-- Adds admin_set_one_liner_day for day association without duplicating one_liners CMS.

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
  difficulty text
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
      select q.id, q.current_version_id, q.difficulty, pq.sort_order
      from public.prof_session_day_practice_questions pq
      join public.questions q on q.id = pq.question_id
      where pq.day_id = p_scope_id
        and q.status = 'approved'
        and q.deleted_at is null
    ),
    picked as (
      select c.id, c.current_version_id, c.difficulty, c.sort_order
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
    select p.id, v.id, v.stem, v.options, p.difficulty
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
    select q.id, q.current_version_id, q.difficulty
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
    select c.id, c.current_version_id, c.difficulty
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
  select p.id, v.id, v.stem, v.options, p.difficulty
  from picked p
  join public.question_versions v on v.id = p.current_version_id
  join marked m on m.question_id = p.id;
end;
$$;

comment on function public.get_practice_batch(text, uuid, int) is
  'Practice batches by subject/book/chapter/topic (grant) or prof_session_day (subscription + published day junction).';

create or replace function public.admin_set_one_liner_day(
  p_one_liner_id uuid,
  p_day_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ol public.one_liners%rowtype;
  v_day public.prof_session_days%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_ol from public.one_liners where id = p_one_liner_id and deleted_at is null;
  if not found then
    raise exception 'one_liner_not_found';
  end if;
  if not public.admin_can_access_year(v_ol.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_day_id is null then
    update public.one_liners
    set prof_session_day_id = null, updated_at = now()
    where id = p_one_liner_id;
    return;
  end if;

  select * into v_day from public.prof_session_days where id = p_day_id and deleted_at is null;
  if not found then
    raise exception 'day_not_found';
  end if;
  if not public.admin_can_access_year(v_day.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_day.subject_id is distinct from v_ol.subject_id then
    raise exception 'subject_mismatch';
  end if;

  update public.one_liners
  set prof_session_day_id = p_day_id, updated_at = now()
  where id = p_one_liner_id;
end;
$$;

revoke execute on function public.admin_set_one_liner_day(uuid, uuid) from public, anon;
grant execute on function public.admin_set_one_liner_day(uuid, uuid) to authenticated, service_role;

create or replace function public.admin_set_test_prof_session_day(
  p_test_id uuid,
  p_day_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
  v_day public.prof_session_days%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_tests')
     and not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'test_not_found';
  end if;
  if not public.admin_can_access_year(v_test.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_day_id is null then
    update public.tests
    set prof_session_day_id = null
    where id = p_test_id;
    return;
  end if;

  select * into v_day from public.prof_session_days where id = p_day_id and deleted_at is null;
  if not found then
    raise exception 'day_not_found';
  end if;
  if not public.admin_can_access_year(v_day.year_id) then
    raise exception 'year_scope_denied';
  end if;
  if v_day.year_id is distinct from v_test.year_id then
    raise exception 'year_mismatch';
  end if;
  if v_test.subject_id is not null
     and v_day.subject_id is distinct from v_test.subject_id then
    raise exception 'subject_mismatch';
  end if;

  update public.tests
  set prof_session_day_id = p_day_id
  where id = p_test_id;

  perform public.log_audit(
    'test_prof_session_day_set',
    'test',
    p_test_id,
    jsonb_build_object('day_id', p_day_id)
  );
end;
$$;

revoke execute on function public.admin_set_test_prof_session_day(uuid, uuid) from public, anon;
grant execute on function public.admin_set_test_prof_session_day(uuid, uuid) to authenticated, service_role;
