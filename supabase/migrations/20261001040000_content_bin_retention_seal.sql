-- Content Bin 7-day retention seal.
-- 1) Backfill NULL purge_after on soft-deleted rows: purge_after = deleted_at + 7 days
-- 2) CHECK: soft-deleted rows must carry purge_after (and active rows must not)
-- 3) soft_delete paths set purge_after from the same deleted_at clock
-- 4) Shared R2: enqueue only after hard-delete, and only when refcount = 0
-- 5) authorize_* / open_* deny soft-deleted entities for all callers (incl. manage_materials)
-- 6) purge_expired_bin_items covers one_liner / mcq_bank_* and pearl R2

-- ---------------------------------------------------------------------------
-- Guard: never invent deleted_at. Abort if soft-delete shape is inconsistent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad int;
begin
  select (
    (select count(*) from public.materials where deleted_at is null and purge_after is not null)
    + (select count(*) from public.material_folders where deleted_at is null and purge_after is not null)
    + (select count(*) from public.pearl_points where deleted_at is null and purge_after is not null)
    + (select count(*) from public.ospe_stations where deleted_at is null and purge_after is not null)
    + (select count(*) from public.questions where deleted_at is null and purge_after is not null)
    + (select count(*) from public.prof_session_days where deleted_at is null and purge_after is not null)
    + (select count(*) from public.one_liners where deleted_at is null and purge_after is not null)
    + (select count(*) from public.mcq_bank_folders where deleted_at is null and purge_after is not null)
    + (select count(*) from public.mcq_bank_subfolders where deleted_at is null and purge_after is not null)
  ) into v_bad;
  if v_bad > 0 then
    raise exception 'content_bin_retention_seal_abort: % active rows have purge_after without deleted_at', v_bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill NULL purge_after for soft-deleted Content Bin entities
-- ---------------------------------------------------------------------------
update public.materials
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.material_folders
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.pearl_points
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.ospe_stations
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.questions
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.prof_session_days
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.one_liners
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.mcq_bank_folders
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

update public.mcq_bank_subfolders
set purge_after = deleted_at + interval '7 days'
where deleted_at is not null and purge_after is null;

-- ---------------------------------------------------------------------------
-- CHECK constraints: bin soft-delete trio consistency
-- ---------------------------------------------------------------------------
alter table public.materials
  drop constraint if exists materials_bin_purge_pair_ck;
alter table public.materials
  add constraint materials_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.material_folders
  drop constraint if exists material_folders_bin_purge_pair_ck;
alter table public.material_folders
  add constraint material_folders_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.pearl_points
  drop constraint if exists pearl_points_bin_purge_pair_ck;
alter table public.pearl_points
  add constraint pearl_points_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.ospe_stations
  drop constraint if exists ospe_stations_bin_purge_pair_ck;
alter table public.ospe_stations
  add constraint ospe_stations_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.questions
  drop constraint if exists questions_bin_purge_pair_ck;
alter table public.questions
  add constraint questions_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.prof_session_days
  drop constraint if exists prof_session_days_bin_purge_pair_ck;
alter table public.prof_session_days
  add constraint prof_session_days_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.one_liners
  drop constraint if exists one_liners_bin_purge_pair_ck;
alter table public.one_liners
  add constraint one_liners_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.mcq_bank_folders
  drop constraint if exists mcq_bank_folders_bin_purge_pair_ck;
alter table public.mcq_bank_folders
  add constraint mcq_bank_folders_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

alter table public.mcq_bank_subfolders
  drop constraint if exists mcq_bank_subfolders_bin_purge_pair_ck;
alter table public.mcq_bank_subfolders
  add constraint mcq_bank_subfolders_bin_purge_pair_ck
  check (
    (deleted_at is null and purge_after is null)
    or (deleted_at is not null and purge_after is not null)
  );

-- ---------------------------------------------------------------------------
-- Shared R2 reference helper + enqueue-if-unreferenced
-- ---------------------------------------------------------------------------
create or replace function public.r2_object_still_referenced(p_object_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_object_key is null or p_object_key = '' then false
    else exists (
      select 1 from public.materials m
      where m.r2_object_key = p_object_key or m.cover_object_key = p_object_key
      union all
      select 1 from public.ospe_stations o where o.r2_object_key = p_object_key
      union all
      select 1 from public.pearl_points p where p.r2_object_key = p_object_key
      union all
      select 1 from public.profiles pr where pr.avatar_object_key = p_object_key
      union all
      select 1 from public.subscription_applications sa
      where sa.screenshot_object_key = p_object_key
    )
  end;
$$;

revoke execute on function public.r2_object_still_referenced(text) from public, anon, authenticated;
grant execute on function public.r2_object_still_referenced(text) to service_role;

comment on function public.r2_object_still_referenced(text) is
  'True when any materials/OSPE/pearl/avatar/payment-proof row still references the R2 object key. Used before enqueue and by purge workers.';

create or replace function public.enqueue_r2_purge_if_unreferenced(
  p_object_key text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_object_key is null then
    return;
  end if;
  if public.r2_object_still_referenced(p_object_key) then
    return;
  end if;
  perform public.enqueue_r2_purge(p_object_key, p_entity_type, p_entity_id);
end;
$$;

revoke execute on function public.enqueue_r2_purge_if_unreferenced(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_r2_purge_if_unreferenced(text, text, uuid) to service_role;

comment on function public.enqueue_r2_purge_if_unreferenced(text, text, uuid) is
  'Enqueue study-content/ R2 purge only when no remaining DB entity references the key. Call AFTER hard-delete.';

-- ---------------------------------------------------------------------------
-- soft_delete_content: purge_after = deleted_at + 7 days
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
begin
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;

  case p_entity_type
    when 'material_folder' then
      update public.material_folders
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;
    when 'material' then
      update public.materials
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;
    when 'pearl_point' then
      update public.pearl_points
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;
    when 'ospe_station' then
      update public.ospe_stations
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;
    when 'question' then
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
      update public.prof_session_days
      set deleted_at = v_deleted_at,
          purge_after = v_deleted_at + interval '7 days',
          deleted_by = auth.uid()
      where id = p_entity_id;
    when 'one_liner' then
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

-- ---------------------------------------------------------------------------
-- Admin soft-delete helpers: same deleted_at + 7 days clock
-- ---------------------------------------------------------------------------
create or replace function public.admin_soft_delete_prof_session_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
  v_deleted_at timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'already_deleted';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.prof_session_days
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = (select auth.uid()),
    updated_at = now()
  where id = p_day_id;

  perform public.log_audit(
    'prof_session_day_soft_deleted',
    'prof_session_day',
    p_day_id,
    jsonb_build_object('year_id', v_row.year_id, 'name', v_row.name)
  );
end;
$$;

create or replace function public.admin_soft_delete_mcq_bank_subfolder(p_subfolder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mcq_bank_subfolders%rowtype;
  v_deleted_at timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
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
    select 1 from public.questions q
    where q.mcq_bank_subfolder_id = p_subfolder_id
      and q.deleted_at is null
  ) then
    raise exception 'subfolder_not_empty';
  end if;

  update public.mcq_bank_subfolders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = (select auth.uid())
  where id = p_subfolder_id;

  perform public.log_audit(
    'mcq_bank_subfolder_soft_deleted',
    'mcq_bank_subfolder',
    p_subfolder_id,
    jsonb_build_object('name', v_row.name, 'folder_id', v_row.folder_id)
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
  v_deleted_at timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('edit_questions') then
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
    select 1 from public.mcq_bank_subfolders sf
    where sf.folder_id = p_folder_id and sf.deleted_at is null
  ) then
    raise exception 'folder_not_empty';
  end if;

  if exists (
    select 1 from public.questions q
    where q.mcq_bank_folder_id = p_folder_id
      and q.deleted_at is null
  ) then
    raise exception 'folder_not_empty';
  end if;

  if v_row.material_folder_id is not null and exists (
    select 1 from public.materials m
    where m.folder_id = v_row.material_folder_id
      and m.deleted_at is null
  ) then
    raise exception 'folder_not_empty';
  end if;

  update public.mcq_bank_folders
  set
    deleted_at = v_deleted_at,
    purge_after = v_deleted_at + interval '7 days',
    deleted_by = (select auth.uid())
  where id = p_folder_id;

  if v_row.material_folder_id is not null then
    update public.material_folders
    set
      deleted_at = v_deleted_at,
      purge_after = v_deleted_at + interval '7 days',
      deleted_by = (select auth.uid())
    where id = v_row.material_folder_id
      and deleted_at is null;
  end if;

  perform public.log_audit(
    'mcq_bank_folder_soft_deleted',
    'mcq_bank_folder',
    p_folder_id,
    jsonb_build_object('name', v_row.name)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: soft-deleted materials/OSPE denied for everyone (incl. manage_materials)
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
begin
  select m.folder_id, m.r2_object_key, m.kind, m.status, m.deleted_at, f.deleted_at
    into v_folder_id, v_key, v_kind, v_status, v_deleted, v_folder_deleted
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
begin
  select m.folder_id, m.drive_url, m.kind, m.status, m.deleted_at, f.deleted_at
    into v_folder_id, v_url, v_kind, v_status, v_deleted, v_folder_deleted
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
-- purge_content: hard-delete then enqueue R2 only if unreferenced
-- ---------------------------------------------------------------------------
create or replace function public.purge_content(p_entity_type text, p_entity_id uuid)
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
  v_keys text[];
  v_key text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder',
    'mcq_bank_subfolder'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type in ('question', 'mcq_bank_folder', 'mcq_bank_subfolder') then
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
      select coalesce(array_agg(k), '{}'::text[])
        into v_keys
      from (
        select m.r2_object_key as k from public.materials m where m.folder_id = p_entity_id
        union all
        select m.cover_object_key from public.materials m where m.folder_id = p_entity_id
      ) s
      where k is not null;
      delete from public.material_folders where id = p_entity_id;
      foreach v_key in array v_keys loop
        perform public.enqueue_r2_purge_if_unreferenced(v_key, 'material', p_entity_id);
      end loop;

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
      delete from public.materials where id = p_entity_id;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge_if_unreferenced(v_cover, 'material', p_entity_id);

    when 'pearl_point' then
      select year_id, left(prompt, 200), r2_object_key
        into v_year_id, v_name, v_r2
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.pearl_points where id = p_entity_id;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'pearl_point', p_entity_id);

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.ospe_stations where id = p_entity_id;
      perform public.enqueue_r2_purge_if_unreferenced(v_r2, 'ospe_station', p_entity_id);

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

    when 'mcq_bank_subfolder' then
      perform public.purge_mcq_bank_subfolder_content(p_entity_id);
      return;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;

comment on function public.purge_content(text, uuid) is
  'Hard-delete one Content Bin entity. R2 keys enqueued only after delete and only when unreferenced. Question path uses LOCAL medverse.allow_question_version_purge.';

-- ---------------------------------------------------------------------------
-- purge_expired_bin_items: eligibility = purge_after <= now()
-- (purge_after is sealed as deleted_at + 7 days)
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_bin_items()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_err text;
  r record;
  v_keys text[];
  v_key text;
begin
  for r in
    select f.id
    from public.material_folders f
    where f.deleted_at is not null
      and f.purge_after is not null
      and f.purge_after <= now()
  loop
    begin
      select coalesce(array_agg(k), '{}'::text[])
        into v_keys
      from (
        select m.r2_object_key as k from public.materials m where m.folder_id = r.id
        union all
        select m.cover_object_key from public.materials m where m.folder_id = r.id
      ) s
      where k is not null;
      delete from public.material_folders where id = r.id;
      foreach v_key in array v_keys loop
        perform public.enqueue_r2_purge_if_unreferenced(v_key, 'material_folder', r.id);
      end loop;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select m.id, m.r2_object_key, m.cover_object_key
    from public.materials m
    where m.deleted_at is not null
      and m.purge_after is not null
      and m.purge_after <= now()
  loop
    begin
      delete from public.materials where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'material', r.id);
      perform public.enqueue_r2_purge_if_unreferenced(r.cover_object_key, 'material', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.pearl_points
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.pearl_points where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'pearl_point', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired pearl_point %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('pearl_point %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.ospe_stations
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.ospe_stations where id = r.id;
      perform public.enqueue_r2_purge_if_unreferenced(r.r2_object_key, 'ospe_station', r.id);
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired ospe_station %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('ospe_station %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.questions
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      if exists (
        select 1 from public.test_questions tq where tq.question_id = r.id
      ) then
        raise exception 'question_referenced_by_test';
      end if;
      perform set_config('medverse.allow_question_version_purge', '1', true);
      delete from public.practice_answers pa
      using public.question_versions qv
      where pa.question_version_id = qv.id
        and qv.question_id = r.id;
      delete from public.questions where id = r.id;
      perform set_config('medverse.allow_question_version_purge', '', true);
      v_count := v_count + 1;
    exception when others then
      perform set_config('medverse.allow_question_version_purge', '', true);
      raise notice 'purge_expired question %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('question %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.prof_session_days
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.prof_session_days where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired prof_session_day %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('prof_session_day %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.one_liners
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.one_liners where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired one_liner %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('one_liner %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.mcq_bank_subfolders
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      if exists (
        select 1 from public.questions q
        where q.mcq_bank_subfolder_id = r.id and q.deleted_at is null
      ) then
        raise exception 'subfolder_not_empty';
      end if;
      delete from public.mcq_bank_subfolders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_subfolder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_subfolder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.mcq_bank_folders
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.mcq_bank_folders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired mcq_bank_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('mcq_bank_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  insert into public.purge_log (deleted_count, error_text)
  values (v_count, v_err);
end;
$$;

comment on function public.purge_expired_bin_items() is
  'Service-role / cron hard-delete for Bin rows where purge_after <= now() (sealed as deleted_at + 7 days). Enqueues unreferenced study-content/ keys after delete.';
