-- Content authorize/open RPCs: enforce is_active_session() (M2).
-- Canonical helper already used by exam RPCs (docs/permissions.md Layer 1).
-- Preserves entitlement checks, admin year-scope, soft-delete denials, CCS.

-- ---------------------------------------------------------------------------
-- authorize_study_object (year-isolation from 20261001070000 + session)
-- ---------------------------------------------------------------------------
create or replace function public.authorize_study_object(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder_id uuid;
  v_key text;
  v_kind text;
  v_status text;
  v_deleted timestamptz;
  v_folder_deleted timestamptz;
  v_year_id uuid;
  v_library_type text;
begin
  if not public.is_active_session() then
    raise exception 'study_object_denied';
  end if;

  select
    m.folder_id,
    m.r2_object_key,
    m.kind,
    m.status,
    m.deleted_at,
    f.deleted_at,
    f.year_id,
    f.library_type
    into
      v_folder_id,
      v_key,
      v_kind,
      v_status,
      v_deleted,
      v_folder_deleted,
      v_year_id,
      v_library_type
  from public.materials m
  join public.material_folders f on f.id = m.folder_id
  where m.id = p_material_id;

  if v_kind is distinct from 'pdf' or v_key is null then
    raise exception 'study_object_denied';
  end if;

  if v_deleted is not null or v_folder_deleted is not null then
    raise exception 'study_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_year_scope_allows(v_year_id, v_library_type) then
      raise exception 'study_object_denied';
    end if;
    return v_key;
  end if;

  if public.can_admin_manage_mcq_bank_material_folder(v_folder_id) then
    return v_key;
  end if;

  if v_status is distinct from 'published' then
    raise exception 'study_object_denied';
  end if;

  if not public.can_access_material_folder(v_folder_id) then
    raise exception 'study_object_denied';
  end if;

  return v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- open_material
-- ---------------------------------------------------------------------------
create or replace function public.open_material(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder_id uuid;
  v_url text;
  v_kind text;
  v_status text;
  v_deleted timestamptz;
  v_folder_deleted timestamptz;
  v_year_id uuid;
  v_library_type text;
begin
  if not public.is_active_session() then
    raise exception 'material_access_denied';
  end if;

  select
    m.folder_id,
    m.drive_url,
    m.kind,
    m.status,
    m.deleted_at,
    f.deleted_at,
    f.year_id,
    f.library_type
    into
      v_folder_id,
      v_url,
      v_kind,
      v_status,
      v_deleted,
      v_folder_deleted,
      v_year_id,
      v_library_type
  from public.materials m
  join public.material_folders f on f.id = m.folder_id
  where m.id = p_material_id;

  if v_kind is distinct from 'drive' or v_url is null then
    raise exception 'material_access_denied';
  end if;

  if v_deleted is not null or v_folder_deleted is not null then
    raise exception 'material_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_year_scope_allows(v_year_id, v_library_type) then
      raise exception 'material_access_denied';
    end if;
    return v_url;
  end if;

  if v_status is distinct from 'published' then
    raise exception 'material_access_denied';
  end if;

  if not public.can_access_material_folder(v_folder_id) then
    raise exception 'material_access_denied';
  end if;

  return v_url;
end;
$$;

-- ---------------------------------------------------------------------------
-- open_study_item
-- ---------------------------------------------------------------------------
create or replace function public.open_study_item(p_material_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.materials%rowtype;
  v_folder_deleted timestamptz;
begin
  if not public.is_active_session() then
    raise exception 'material_access_denied';
  end if;

  select * into v_row from public.materials where id = p_material_id;
  if not found then
    raise exception 'material_access_denied';
  end if;

  select deleted_at into v_folder_deleted
  from public.material_folders
  where id = v_row.folder_id;

  if v_row.deleted_at is not null or v_folder_deleted is not null then
    raise exception 'material_access_denied';
  end if;

  if not public.has_permission('manage_materials') then
    if v_row.status is distinct from 'published' then
      raise exception 'material_access_denied';
    end if;
    if not public.can_access_material_folder(v_row.folder_id) then
      raise exception 'material_access_denied';
    end if;
  end if;

  if v_row.kind = 'drive' then
    raise exception 'material_wrong_kind';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'title', v_row.title,
    'description', v_row.description,
    'reference_text', v_row.reference_text,
    'status', v_row.status,
    'body_text', case when v_row.kind = 'guideline' then v_row.body_text else null end,
    'has_pdf', v_row.kind = 'pdf' and v_row.r2_object_key is not null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- authorize_ospe_station_object
-- ---------------------------------------------------------------------------
create or replace function public.authorize_ospe_station_object(p_station_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.ospe_stations%rowtype;
begin
  if not public.is_active_session() then
    raise exception 'ospe_object_denied';
  end if;

  select * into v_row from public.ospe_stations where id = p_station_id;
  if not found or v_row.r2_object_key is null then
    raise exception 'ospe_object_denied';
  end if;

  if v_row.deleted_at is not null then
    raise exception 'ospe_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'ospe_object_denied';
    end if;
    return v_row.r2_object_key;
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'ospe_object_denied';
  end if;

  if not public.can_access_ospe_station(p_station_id) then
    raise exception 'ospe_object_denied';
  end if;

  return v_row.r2_object_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- open_ospe_station
-- ---------------------------------------------------------------------------
create or replace function public.open_ospe_station(p_station_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.ospe_stations%rowtype;
begin
  if not public.is_active_session() then
    raise exception 'ospe_access_denied';
  end if;

  select * into v_row from public.ospe_stations where id = p_station_id;
  if not found then
    raise exception 'ospe_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'ospe_access_denied';
    end if;
    return jsonb_build_object(
      'id', v_row.id,
      'title', v_row.title,
      'answer', v_row.answer
    );
  end if;

  if not public.can_access_ospe_station(p_station_id) then
    raise exception 'ospe_access_denied';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'answer', v_row.answer
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- authorize_pearl_object
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
  if not public.is_active_session() then
    raise exception 'pearl_object_denied';
  end if;

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

-- ---------------------------------------------------------------------------
-- open_pearl
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
  if not public.is_active_session() then
    raise exception 'pearl_access_denied';
  end if;

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

-- ---------------------------------------------------------------------------
-- authorize_avatar_object
-- ---------------------------------------------------------------------------
create or replace function public.authorize_avatar_object(p_student_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid;
  v_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_active_session() then
    raise exception 'avatar_forbidden';
  end if;

  v_target := coalesce(p_student_id, v_uid);

  if v_target is distinct from v_uid
     and not public.has_permission('view_students')
     and not public.has_permission('view_analytics')
     and not public.has_permission('manage_students') then
    raise exception 'avatar_forbidden';
  end if;

  select avatar_object_key into v_key
  from public.profiles
  where id = v_target;

  if v_key is null or v_key !~ '^study-content/avatars/' then
    raise exception 'avatar_not_found';
  end if;

  return v_key;
end;
$$;

revoke all on function public.authorize_study_object(uuid) from public, anon;
grant execute on function public.authorize_study_object(uuid) to authenticated, service_role;
revoke all on function public.open_material(uuid) from public, anon;
grant execute on function public.open_material(uuid) to authenticated, service_role;
revoke all on function public.open_study_item(uuid) from public, anon;
grant execute on function public.open_study_item(uuid) to authenticated, service_role;
revoke all on function public.authorize_ospe_station_object(uuid) from public, anon;
grant execute on function public.authorize_ospe_station_object(uuid) to authenticated, service_role;
revoke all on function public.open_ospe_station(uuid) from public, anon;
grant execute on function public.open_ospe_station(uuid) to authenticated, service_role;
revoke all on function public.authorize_pearl_object(uuid) from public, anon;
grant execute on function public.authorize_pearl_object(uuid) to authenticated, service_role;
revoke all on function public.open_pearl(uuid) from public, anon;
grant execute on function public.open_pearl(uuid) to authenticated, service_role;
revoke all on function public.authorize_avatar_object(uuid) from public, anon;
grant execute on function public.authorize_avatar_object(uuid) to authenticated, service_role;

comment on function public.authorize_study_object(uuid) is
  'Returns R2 study-content key after is_active_session + entitlement/admin year scope.';
comment on function public.open_material(uuid) is
  'Returns Drive URL after is_active_session + entitlement/admin year scope.';
