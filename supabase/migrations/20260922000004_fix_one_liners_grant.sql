-- Fix 1: upgrade one_liners SELECT grant from column-level to table-level.
-- Students are protected by RLS row-level filtering (deleted_at is null check),
-- so column-level grant is unnecessary and blocks admin access to deleted_at.
-- Also grant to anon (RLS returns 0 rows; no anon policy allows reading data).
revoke select on public.one_liners from anon;
revoke select on public.one_liners from authenticated;
grant select on public.one_liners to anon, authenticated;

-- Grant EXECUTE on RLS helper functions to anon so policy evaluation succeeds
-- (the functions themselves return false for unauthenticated callers).
grant execute on function public.has_permission(text) to anon;
grant execute on function public.admin_can_access_year(uuid) to anon;

-- Fix 2: bulk_soft_delete_questions empty-array guard.
-- array_length('{}', 1) returns NULL (not 0), so the old check never fired.
-- Replace with cardinality() which returns 0 for an empty array.
create or replace function public.bulk_soft_delete_questions(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_binned int := 0;
  v_blocked int := 0;
  v_not_found int := 0;
  v_blocked_ids uuid[] := '{}';
begin
  if not public.has_permission('edit_questions') then
    raise exception 'permission_denied';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'no ids provided';
  end if;

  foreach v_id in array p_ids loop
    if not exists (select 1 from public.questions where id = v_id) then
      v_not_found := v_not_found + 1;
      continue;
    end if;

    if exists (
      select 1 from public.test_questions tq
      join public.tests t on t.id = tq.test_id
      where tq.question_id = v_id
        and t.status not in ('draft', 'archived', 'invalidated')
    ) then
      v_blocked := v_blocked + 1;
      v_blocked_ids := v_blocked_ids || v_id;
      continue;
    end if;

    update public.questions
    set deleted_at = now(),
        purge_after = now() + interval '7 days',
        deleted_by = auth.uid()
    where id = v_id
      and deleted_at is null;

    if found then
      v_binned := v_binned + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'binned', v_binned,
    'blocked_active_test', v_blocked,
    'not_found', v_not_found,
    'blocked_ids', to_jsonb(v_blocked_ids)
  );
end;
$$;

-- Fix 4: restore can_access_test entitlement check dropped in 20260922000001 Part D.
-- The original function (20260915034353) calls can_view_test (catalog check) plus
-- resource_content_allowed (entitlement/subscription check). Part D replaced both
-- with a simple enrollment check, breaking subscription enforcement.
-- can_view_test has no time window guard, so mock tests with no opens_at/closes_at
-- already work with the original logic — the rewrite was unnecessary.
create or replace function public.can_access_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_test(p_test_id)
    and exists (
      select 1 from public.tests t
      where t.id = p_test_id
        and public.resource_content_allowed(
          'test', null, t.id, null, t.entitlement, t.required_plan_id
        )
    );
$$;

-- Fix 3: validate_test — restore 'no duplicate questions' and 'duration > 0' checks
-- removed in 20260922000001. Keep the mock-test schedule relaxation intact.
create or replace function public.validate_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tests%rowtype;
  v jsonb := '[]'::jsonb;
  n_questions int;
  n_distinct int;
  n_unapproved int;
  n_bad_content int;
  has_audience boolean;
  is_mock boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select * into t from public.tests where id = p_test_id;
  if not found then raise exception 'test not found'; end if;

  is_mock := (t.test_type = 'mock');

  select count(*), count(distinct question_id)
    into n_questions, n_distinct
  from public.test_questions
  where test_id = p_test_id;

  v := v || jsonb_build_object('check', 'question count >= ' || t.min_questions,
    'pass', n_questions >= t.min_questions and n_questions > 0,
    'detail', n_questions || ' questions');

  v := v || jsonb_build_object('check', 'no duplicate questions',
    'pass', n_questions = n_distinct,
    'detail', case when n_questions = n_distinct then 'ok'
                   else (n_questions - n_distinct) || ' duplicates' end);

  select count(*) into n_unapproved
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  where tq.test_id = p_test_id and q.status <> 'approved';
  v := v || jsonb_build_object('check', 'all questions approved',
    'pass', n_unapproved = 0, 'detail', n_unapproved || ' not approved');

  select count(*) into n_bad_content
  from public.test_questions tq
  join public.questions q on q.id = tq.question_id
  join public.question_versions qv on qv.id = q.current_version_id
  where tq.test_id = p_test_id
    and (
      jsonb_array_length(qv.options) not between 4 and 5
      or not exists (
        select 1 from jsonb_array_elements(qv.options) o
        where o ->> 'key' = trim(qv.correct_key::text)
      )
    );
  v := v || jsonb_build_object('check', 'options complete + valid correct keys',
    'pass', n_bad_content = 0, 'detail', n_bad_content || ' invalid');

  if is_mock then
    v := v || jsonb_build_object('check', 'valid schedule (optional for mock tests)',
      'pass', true,
      'detail', case
        when t.opens_at is null then 'no window set — mock runs year-round'
        else coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset')
      end);
  else
    v := v || jsonb_build_object('check', 'valid schedule',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.opens_at < t.closes_at and t.closes_at > now(),
      'detail', coalesce(t.opens_at::text, 'unset') || ' → ' || coalesce(t.closes_at::text, 'unset'));
  end if;

  v := v || jsonb_build_object('check', 'duration > 0',
    'pass', t.duration_minutes > 0, 'detail', t.duration_minutes || ' minutes');

  if is_mock then
    v := v || jsonb_build_object('check', 'duration fits window (optional for mock tests)',
      'pass', true, 'detail', t.duration_minutes || ' minutes');
  else
    v := v || jsonb_build_object('check', 'duration fits the window',
      'pass', t.opens_at is not null and t.closes_at is not null
        and t.duration_minutes * interval '1 minute' <= (t.closes_at - t.opens_at),
      'detail', t.duration_minutes || ' minutes');
  end if;

  v := v || jsonb_build_object('check', 'valid marking scheme',
    'pass', t.marks_per_question > 0 and t.negative_mark >= 0,
    'detail', t.marks_per_question || ' per question, −' || t.negative_mark || ' per wrong');

  select exists (select 1 from public.test_audiences where test_id = p_test_id)
    or exists (select 1 from public.access_grants
      where test_id = p_test_id and grant_type = 'test' and revoked_at is null)
  into has_audience;
  v := v || jsonb_build_object('check', 'audience assigned (year or student grants)',
    'pass', has_audience,
    'detail', case when has_audience then 'ok' else 'nobody can see this test' end);

  return v;
end;
$$;

-- Fix 5: restore is_admin() guard in list_content_bin.
-- 20260922000002 rewrote the function as pure SQL and dropped the admin check,
-- causing students to receive 0 rows silently instead of an 'admin_only' exception.
-- Keep RETURNS TABLE (test 22 already uses count(*) from), but change to plpgsql
-- so we can guard at the top.
create or replace function public.list_content_bin(p_year_id uuid default null)
returns table (
  entity_type text,
  entity_id uuid,
  name text,
  year_id uuid,
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid,
  has_r2 boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;
  if p_year_id is not null and not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  return query
    select 'material_folder'::text, mf.id, mf.name, mf.year_id, mf.deleted_at, mf.purge_after, mf.deleted_by, false
    from public.material_folders mf
    where mf.deleted_at is not null
      and (p_year_id is null or mf.year_id = p_year_id)
      and public.admin_can_access_year(mf.year_id)
    union all
    select 'material'::text, m.id, m.title, mf2.year_id, m.deleted_at, m.purge_after, m.deleted_by,
      (m.r2_object_key is not null)
    from public.materials m
    join public.material_folders mf2 on mf2.id = m.folder_id
    where m.deleted_at is not null
      and (p_year_id is null or mf2.year_id = p_year_id)
      and public.admin_can_access_year(mf2.year_id)
    union all
    select 'pearl_point'::text, pp.id, pp.prompt, pp.year_id, pp.deleted_at, pp.purge_after, pp.deleted_by, false
    from public.pearl_points pp
    where pp.deleted_at is not null
      and (p_year_id is null or pp.year_id = p_year_id)
      and public.admin_can_access_year(pp.year_id)
    union all
    select 'ospe_station'::text, os.id, os.title, os.year_id, os.deleted_at, os.purge_after, os.deleted_by,
      (os.r2_object_key is not null)
    from public.ospe_stations os
    where os.deleted_at is not null
      and (p_year_id is null or os.year_id = p_year_id)
      and public.admin_can_access_year(os.year_id)
    union all
    select 'question'::text, q.id, left(coalesce(qv.stem, 'Untitled'), 80), q.year_id,
      q.deleted_at, q.purge_after, q.deleted_by, false
    from public.questions q
    left join public.question_versions qv on qv.id = q.current_version_id
    where q.deleted_at is not null
      and (p_year_id is null or q.year_id = p_year_id)
      and public.admin_can_access_year(q.year_id)
    union all
    select 'prof_session_day'::text, psd.id, psd.name, psd.year_id, psd.deleted_at, psd.purge_after, psd.deleted_by, false
    from public.prof_session_days psd
    where psd.deleted_at is not null
      and (p_year_id is null or psd.year_id = p_year_id)
      and public.admin_can_access_year(psd.year_id)
    union all
    select 'one_liner'::text, ol.id, left(ol.title, 80), ol.year_id, ol.deleted_at, ol.purge_after, ol.deleted_by, false
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id);
end;
$$;

-- Fix 6: restore R2 purge queue insertion and year scope checks in purge_content.
-- 20260922000002 replaced the full implementation with simple DELETE statements,
-- dropping enqueue_r2_purge calls for materials/ospe_stations, year scope guards,
-- and audit logging. Restore original logic and add 'one_liner' support.
create or replace function public.purge_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
  v_r2 text;
  v_cover text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type = 'question' then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
  else
    if not public.has_permission('manage_materials') then
      raise exception 'permission_denied';
    end if;
  end if;

  case p_entity_type
    when 'material_folder' then
      select year_id, name into v_year_id, v_name
      from public.material_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m where m.folder_id = p_entity_id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
        perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      end loop;
      delete from public.material_folders where id = p_entity_id;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key
        into v_year_id, v_name, v_r2, v_cover
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      delete from public.materials where id = p_entity_id;

    when 'pearl_point' then
      select year_id, left(prompt, 200) into v_year_id, v_name
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.pearl_points where id = p_entity_id;

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'ospe_station', p_entity_id);
      delete from public.ospe_stations where id = p_entity_id;

    when 'question' then
      select year_id, coalesce(stem_normalized, id::text) into v_year_id, v_name
      from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      if exists (select 1 from public.test_questions where question_id = p_entity_id) then
        raise exception 'question_referenced_by_test';
      end if;
      delete from public.questions where id = p_entity_id;

    when 'prof_session_day' then
      select year_id, name into v_year_id, v_name
      from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.prof_session_days where id = p_entity_id;

    when 'one_liner' then
      select year_id, left(title, 200) into v_year_id, v_name
      from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.one_liners where id = p_entity_id and deleted_at is not null;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('year_id', v_year_id, 'name', v_name)
  );
end;
$$;
