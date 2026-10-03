-- Cascade Bin lineage must use wall-clock timestamps so independently
-- soft-deleted rows in the same transaction do not share deleted_at with
-- a later hierarchy cascade (Postgres now() is transaction-stable).
-- Behavior otherwise unchanged from 20261003120000 / 20261001070000.

create or replace function public.admin_soft_delete_mcq_bank_subfolder(p_subfolder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_subfolders%rowtype;
  v_deleted_at timestamptz := clock_timestamp();
  v_uid uuid := (select auth.uid());
  v_q_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_main_admin() then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.mcq_bank_subfolders where id = p_subfolder_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'mcq_bank_subfolder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if exists (
    select 1
    from public.questions q
    join public.test_questions tq on tq.question_id = q.id
    join public.tests t on t.id = tq.test_id
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null
      and t.status in ('published', 'closed')
  ) then
    raise exception 'question_referenced_by_active_test';
  end if;

  update public.questions
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where mcq_bank_subfolder_id = p_subfolder_id
    and deleted_at is null;
  get diagnostics v_q_count = row_count;

  update public.mcq_bank_subfolders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where id = p_subfolder_id;

  perform public.log_audit(
    'mcq_bank_subfolder_soft_deleted',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object(
      'name', v_row.name,
      'folder_id', v_row.folder_id,
      'cascaded_questions', v_q_count,
      'deleted_at', v_deleted_at
    )
  );
end;
$$;

create or replace function public.admin_soft_delete_mcq_bank_folder(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_folders%rowtype;
  v_deleted_at timestamptz := clock_timestamp();
  v_uid uuid := (select auth.uid());
  v_q_count int := 0;
  v_sf_count int := 0;
  v_mat_count int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_main_admin() then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.mcq_bank_folders where id = p_folder_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'mcq_bank_folder_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if exists (
    select 1
    from public.questions q
    join public.test_questions tq on tq.question_id = q.id
    join public.tests t on t.id = tq.test_id
    where q.deleted_at is null
      and t.status in ('published', 'closed')
      and (
        q.mcq_bank_folder_id = p_folder_id
        or q.mcq_bank_subfolder_id in (
          select sf.id from public.mcq_bank_subfolders sf
          where sf.folder_id = p_folder_id and sf.deleted_at is null
        )
      )
  ) then
    raise exception 'question_referenced_by_active_test';
  end if;

  update public.questions q
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where q.deleted_at is null
    and (
      q.mcq_bank_folder_id = p_folder_id
      or q.mcq_bank_subfolder_id in (
        select sf.id from public.mcq_bank_subfolders sf
        where sf.folder_id = p_folder_id and sf.deleted_at is null
      )
    );
  get diagnostics v_q_count = row_count;

  update public.mcq_bank_subfolders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where folder_id = p_folder_id
    and deleted_at is null;
  get diagnostics v_sf_count = row_count;

  if v_row.material_folder_id is not null then
    update public.materials
    set
      deleted_at = v_deleted_at,
      purge_after = v_deleted_at + interval '7 days',
      deleted_by = v_uid
    where folder_id = v_row.material_folder_id
      and deleted_at is null;
    get diagnostics v_mat_count = row_count;

    update public.material_folders
    set
      deleted_at = v_deleted_at,
      purge_after = v_deleted_at + interval '7 days',
      deleted_by = v_uid
    where id = v_row.material_folder_id
      and deleted_at is null;
  end if;

  update public.mcq_bank_folders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = v_uid
  where id = p_folder_id;

  perform public.log_audit(
    'mcq_bank_folder_soft_deleted',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object(
      'name', v_row.name,
      'cascaded_questions', v_q_count,
      'cascaded_subfolders', v_sf_count,
      'cascaded_materials', v_mat_count,
      'deleted_at', v_deleted_at
    )
  );
end;
$$;

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
  v_deleted_at timestamptz := clock_timestamp();
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

revoke all on function public.soft_delete_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_content(text, uuid) to authenticated, service_role;

revoke all on function public.admin_soft_delete_mcq_bank_folder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_folder(uuid) to authenticated, service_role;

revoke all on function public.admin_soft_delete_mcq_bank_subfolder(uuid) from public, anon;
grant execute on function public.admin_soft_delete_mcq_bank_subfolder(uuid) to authenticated, service_role;
