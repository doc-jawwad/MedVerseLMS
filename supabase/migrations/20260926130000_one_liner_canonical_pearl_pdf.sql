-- Canonical student "One Liner" surface keeps pearl_points as the store.
-- Product label is One Liner; optional private PDF uses study-content/ R2
-- (same allocate/authorize/discard family as materials / OSPE).
-- Does not drop or migrate one_liners (Prof. Session day attachment remains).

-- ---------------------------------------------------------------------------
-- Optional PDF attachment on pearl_points
-- ---------------------------------------------------------------------------
alter table public.pearl_points
  add column if not exists r2_object_key text,
  add column if not exists r2_content_type text,
  add column if not exists r2_byte_size int;

alter table public.pearl_points
  drop constraint if exists pearl_points_r2_object_key_check;
alter table public.pearl_points
  add constraint pearl_points_r2_object_key_check
  check (
    r2_object_key is null
    or (
      r2_object_key ~ '^study-content/'
      and r2_object_key !~ '[[:space:]]'
    )
  );

alter table public.pearl_points
  drop constraint if exists pearl_points_r2_content_type_check;
alter table public.pearl_points
  add constraint pearl_points_r2_content_type_check
  check (
    r2_content_type is null
    or r2_content_type = 'application/pdf'
  );

alter table public.pearl_points
  drop constraint if exists pearl_points_r2_byte_size_check;
alter table public.pearl_points
  add constraint pearl_points_r2_byte_size_check
  check (
    r2_byte_size is null
    or r2_byte_size > 0
  );

alter table public.pearl_points
  drop constraint if exists pearl_points_r2_payload_check;
alter table public.pearl_points
  add constraint pearl_points_r2_payload_check
  check (
    (r2_object_key is null and r2_content_type is null and r2_byte_size is null)
    or (
      r2_object_key is not null
      and r2_content_type = 'application/pdf'
      and r2_byte_size is not null
      and r2_byte_size > 0
    )
  );

comment on column public.pearl_points.r2_object_key is
  'Optional private R2 study-content/ PDF source. Hidden from student SELECT; authorize_pearl_object + Next.js private stream.';

-- Student-visible flag without exposing the object key
alter table public.pearl_points
  drop column if exists has_source_pdf;
alter table public.pearl_points
  add column has_source_pdf boolean
  generated always as (r2_object_key is not null) stored;

comment on column public.pearl_points.has_source_pdf is
  'Derived: optional source PDF attached. Safe for student catalog SELECT.';

-- Re-grant catalog columns (include has_source_pdf; never grant R2 key columns)
revoke select on public.pearl_points from public;
revoke select on public.pearl_points from anon;
revoke select on public.pearl_points from authenticated;
grant select (
  id,
  tenant_id,
  prompt,
  year_id,
  subject_id,
  chapter_id,
  topic_id,
  status,
  entitlement,
  required_plan_id,
  sort_order,
  has_source_pdf,
  created_at,
  updated_at
) on public.pearl_points to authenticated;

-- ---------------------------------------------------------------------------
-- Authorize PDF object key (admin or entitled student)
-- ---------------------------------------------------------------------------
create or replace function public.authorize_pearl_object(p_pearl_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pearl_points%rowtype;
begin
  select * into v_row from public.pearl_points where id = p_pearl_id;
  if not found or v_row.r2_object_key is null or v_row.deleted_at is not null then
    raise exception 'pearl_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'pearl_object_denied';
    end if;
    return v_row.r2_object_key;
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'pearl_object_denied';
  end if;

  if not public.can_access_pearl(p_pearl_id) then
    raise exception 'pearl_object_denied';
  end if;

  return v_row.r2_object_key;
end;
$$;

revoke execute on function public.authorize_pearl_object(uuid) from public, anon;
grant execute on function public.authorize_pearl_object(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- open_pearl / get_pearl_for_admin — include has_source_pdf; admin gets size
-- ---------------------------------------------------------------------------
create or replace function public.open_pearl(p_pearl_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pearl_points%rowtype;
begin
  select * into v_row from public.pearl_points where id = p_pearl_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'pearl_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'pearl_access_denied';
    end if;
    return jsonb_build_object(
      'id', v_row.id,
      'prompt', v_row.prompt,
      'answer', v_row.answer,
      'explanation', v_row.explanation,
      'year_id', v_row.year_id,
      'subject_id', v_row.subject_id,
      'chapter_id', v_row.chapter_id,
      'topic_id', v_row.topic_id,
      'status', v_row.status,
      'entitlement', v_row.entitlement,
      'has_source_pdf', (v_row.r2_object_key is not null),
      'r2_byte_size', v_row.r2_byte_size,
      'r2_object_key', v_row.r2_object_key
    );
  end if;

  if not public.can_access_pearl(p_pearl_id) then
    raise exception 'pearl_access_denied';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'prompt', v_row.prompt,
    'answer', v_row.answer,
    'explanation', v_row.explanation,
    'year_id', v_row.year_id,
    'subject_id', v_row.subject_id,
    'chapter_id', v_row.chapter_id,
    'topic_id', v_row.topic_id,
    'has_source_pdf', (v_row.r2_object_key is not null)
  );
end;
$$;

create or replace function public.get_pearl_for_admin(p_pearl_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  return public.open_pearl(p_pearl_id);
end;
$$;

revoke execute on function public.open_pearl(uuid) from public, anon;
grant execute on function public.open_pearl(uuid) to authenticated, service_role;
revoke execute on function public.get_pearl_for_admin(uuid) from public, anon;
grant execute on function public.get_pearl_for_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- purge_content: enqueue R2 when purging a pearl with optional PDF
-- (body matches 20260925170000 + pearl R2 enqueue)
-- ---------------------------------------------------------------------------
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
  v_library_type text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type in ('question', 'mcq_bank_folder') then
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
      select year_id, name, library_type into v_year_id, v_name, v_library_type
      from public.material_folders where id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if v_library_type = 'career_counseling_series' then
        if v_year_id is not null then raise exception 'invalid_ccs_year_scope'; end if;
      else
        if v_year_id is null then raise exception 'entity_not_found'; end if;
        if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      end if;
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m where m.folder_id = p_entity_id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
        perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      end loop;
      delete from public.material_folders where id = p_entity_id;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key, f.library_type
        into v_year_id, v_name, v_r2, v_cover, v_library_type
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if v_library_type = 'career_counseling_series' then
        if v_year_id is not null then raise exception 'invalid_ccs_year_scope'; end if;
      else
        if v_year_id is null then raise exception 'entity_not_found'; end if;
        if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      end if;
      perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      delete from public.materials where id = p_entity_id;

    when 'pearl_point' then
      select year_id, left(prompt, 200), r2_object_key
        into v_year_id, v_name, v_r2
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'pearl_point', p_entity_id);
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
      perform set_config('medverse.allow_question_version_purge', '1', true);
      delete from public.practice_answers pa
      using public.question_versions qv
      where pa.question_version_id = qv.id
        and qv.question_id = p_entity_id;
      delete from public.questions where id = p_entity_id;
      perform set_config('medverse.allow_question_version_purge', '', true);

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

    when 'mcq_bank_folder' then
      select year_id, name into v_year_id, v_name
      from public.mcq_bank_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.mcq_bank_folders where id = p_entity_id and deleted_at is not null;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;
