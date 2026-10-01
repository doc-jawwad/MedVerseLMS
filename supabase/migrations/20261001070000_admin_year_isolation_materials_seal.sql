-- Admin year isolation seal for materials / MCQ Bank write paths + soft-delete/restore.
-- Aligns manage_materials authorize + RLS + soft_delete/restore with OSPE/One Liner /
-- purge_content year-scope patterns. CCS (library_type = career_counseling_series,
-- year_id IS NULL) remains manage_materials-only without a year assignment check.

-- ---------------------------------------------------------------------------
-- Helper: year/CCS scope for material folders (reusable in RLS + RPCs)
-- ---------------------------------------------------------------------------
create or replace function public.admin_year_scope_allows(
  p_year_id uuid,
  p_library_type text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_library_type = 'career_counseling_series' then p_year_id is null
      when p_year_id is null then false
      else public.admin_can_access_year(p_year_id)
    end;
$$;

revoke all on function public.admin_year_scope_allows(uuid, text) from public, anon;
grant execute on function public.admin_year_scope_allows(uuid, text) to authenticated, service_role;

comment on function public.admin_year_scope_allows(uuid, text) is
  'True when caller may act on content in year_id; CCS (library_type + null year) allowed without year assignment.';

-- ---------------------------------------------------------------------------
-- H1: authorize_study_object / open_material — year-scope manage_materials
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
-- H2: materials / material_folders write RLS — permission + year/CCS
-- ---------------------------------------------------------------------------
drop policy if exists materials_admin_insert on public.materials;
create policy materials_admin_insert on public.materials
  for insert with check (
    (
      public.has_permission('manage_materials')
      and exists (
        select 1
        from public.material_folders f
        where f.id = materials.folder_id
          and public.admin_year_scope_allows(f.year_id, f.library_type)
      )
    )
    or public.can_admin_manage_mcq_bank_material_folder(materials.folder_id)
  );

drop policy if exists materials_admin_update on public.materials;
create policy materials_admin_update on public.materials
  for update using (
    (
      public.has_permission('manage_materials')
      and exists (
        select 1
        from public.material_folders f
        where f.id = materials.folder_id
          and public.admin_year_scope_allows(f.year_id, f.library_type)
      )
    )
    or public.can_admin_manage_mcq_bank_material_folder(materials.folder_id)
  )
  with check (
    (
      public.has_permission('manage_materials')
      and exists (
        select 1
        from public.material_folders f
        where f.id = materials.folder_id
          and public.admin_year_scope_allows(f.year_id, f.library_type)
      )
    )
    or public.can_admin_manage_mcq_bank_material_folder(materials.folder_id)
  );

drop policy if exists materials_admin_delete on public.materials;
create policy materials_admin_delete on public.materials
  for delete using (
    public.has_permission('manage_materials')
    and exists (
      select 1
      from public.material_folders f
      where f.id = materials.folder_id
        and public.admin_year_scope_allows(f.year_id, f.library_type)
    )
  );

drop policy if exists material_folders_admin_insert on public.material_folders;
create policy material_folders_admin_insert on public.material_folders
  for insert with check (
    public.has_permission('manage_materials')
    and public.admin_year_scope_allows(year_id, library_type)
  );

drop policy if exists material_folders_admin_update on public.material_folders;
create policy material_folders_admin_update on public.material_folders
  for update using (
    (
      public.has_permission('manage_materials')
      and public.admin_year_scope_allows(year_id, library_type)
    )
    or (
      public.has_permission('edit_questions')
      and library_type = 'mcq_bank'
      and year_id is not null
      and public.admin_can_access_year(year_id)
    )
  )
  with check (
    (
      public.has_permission('manage_materials')
      and public.admin_year_scope_allows(year_id, library_type)
    )
    or (
      public.has_permission('edit_questions')
      and library_type = 'mcq_bank'
      and year_id is not null
      and public.admin_can_access_year(year_id)
    )
  );

drop policy if exists material_folders_admin_delete on public.material_folders;
create policy material_folders_admin_delete on public.material_folders
  for delete using (
    public.has_permission('manage_materials')
    and public.admin_year_scope_allows(year_id, library_type)
  );

-- MCQ Bank folder/subfolder DML: edit_questions + assigned year
drop policy if exists mcq_bank_folders_admin_insert on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_insert on public.mcq_bank_folders
  for insert with check (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists mcq_bank_folders_admin_update on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_update on public.mcq_bank_folders
  for update using (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  )
  with check (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists mcq_bank_folders_admin_delete on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_delete on public.mcq_bank_folders
  for delete using (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists mcq_bank_subfolders_admin_insert on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_insert on public.mcq_bank_subfolders
  for insert with check (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists mcq_bank_subfolders_admin_update on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_update on public.mcq_bank_subfolders
  for update using (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  )
  with check (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists mcq_bank_subfolders_admin_delete on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_delete on public.mcq_bank_subfolders
  for delete using (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

-- ---------------------------------------------------------------------------
-- H3: soft_delete_content + restore_content — entity permission + year/CCS
-- (7-day purge_after clock unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_at timestamptz := now();
  v_year_id uuid;
  v_library_type text;
  v_folder_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  case p_entity_type
    when 'material_folder' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id, library_type into v_year_id, v_library_type
      from public.material_folders where id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if not public.admin_year_scope_allows(v_year_id, v_library_type) then
        raise exception 'year_scope_denied';
      end if;
      update public.material_folders
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'material' then
      select m.folder_id, f.year_id, f.library_type
        into v_folder_id, v_year_id, v_library_type
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if public.has_permission('manage_materials') then
        if not public.admin_year_scope_allows(v_year_id, v_library_type) then
          raise exception 'year_scope_denied';
        end if;
      elsif public.can_admin_manage_mcq_bank_material_folder(v_folder_id) then
        null;
      else
        raise exception 'permission_denied';
      end if;
      update public.materials
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'pearl_point' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.pearl_points
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'ospe_station' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.ospe_stations
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'question' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      if exists (
        select 1 from public.test_questions tq
        join public.tests t on t.id = tq.test_id
        where tq.question_id = p_entity_id
          and t.status not in ('draft', 'archived', 'invalidated')
      ) then
        raise exception 'question_in_active_test';
      end if;
      update public.questions
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'prof_session_day' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.prof_session_days
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'one_liner' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.one_liners
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;

    when 'mcq_bank_folder' then
      perform public.admin_soft_delete_mcq_bank_folder(p_entity_id);

    when 'mcq_bank_subfolder' then
      perform public.admin_soft_delete_mcq_bank_subfolder(p_entity_id);

    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

create or replace function public.restore_content(
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
  v_library_type text;
  v_folder_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  case p_entity_type
    when 'material_folder' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id, library_type into v_year_id, v_library_type
      from public.material_folders where id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if not public.admin_year_scope_allows(v_year_id, v_library_type) then
        raise exception 'year_scope_denied';
      end if;
      update public.material_folders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'material' then
      select m.folder_id, f.year_id, f.library_type
        into v_folder_id, v_year_id, v_library_type
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if public.has_permission('manage_materials') then
        if not public.admin_year_scope_allows(v_year_id, v_library_type) then
          raise exception 'year_scope_denied';
        end if;
      elsif public.can_admin_manage_mcq_bank_material_folder(v_folder_id) then
        null;
      else
        raise exception 'permission_denied';
      end if;
      update public.materials
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'pearl_point' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.pearl_points
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'ospe_station' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.ospe_stations
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'question' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.questions
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'prof_session_day' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.prof_session_days
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'one_liner' then
      if not public.has_permission('manage_materials') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.one_liners
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'mcq_bank_folder' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      select year_id into v_year_id
      from public.mcq_bank_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.mcq_bank_folders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    when 'mcq_bank_subfolder' then
      if not public.has_permission('edit_questions') then
        raise exception 'permission_denied';
      end if;
      select sf.year_id into v_year_id
      from public.mcq_bank_subfolders sf
      join public.mcq_bank_folders f on f.id = sf.folder_id
      where sf.id = p_entity_id
        and sf.deleted_at is not null
        and f.deleted_at is null;
      if v_year_id is null then
        raise exception 'mcq_bank_subfolder_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      update public.mcq_bank_subfolders
      set deleted_at = null, purge_after = null, deleted_by = null
      where id = p_entity_id;

    else
      raise exception 'unknown entity type: %', p_entity_type;
  end case;
end;
$$;

revoke all on function public.soft_delete_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_content(text, uuid) to authenticated, service_role;

revoke all on function public.restore_content(text, uuid) from public, anon;
grant execute on function public.restore_content(text, uuid) to authenticated, service_role;

revoke all on function public.authorize_study_object(uuid) from public, anon;
grant execute on function public.authorize_study_object(uuid) to authenticated, service_role;

revoke all on function public.open_material(uuid) from public, anon;
grant execute on function public.open_material(uuid) to authenticated, service_role;
