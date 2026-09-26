-- MCQ Bank PDF upload for edit_questions (class-scoped) without globally
-- weakening allocate_study_object_key for normal materials.
-- Aligns allocate/authorize/discard/SELECT with materials INSERT already opened
-- for library_type = mcq_bank in 20260926150000.

-- ---------------------------------------------------------------------------
-- 1. Helper: edit_questions + assigned-class year on an mcq_bank material folder
-- ---------------------------------------------------------------------------
create or replace function public.can_admin_manage_mcq_bank_material_folder(
  p_folder_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_permission('edit_questions')
    and exists (
      select 1
      from public.material_folders f
      where f.id = p_folder_id
        and f.library_type = 'mcq_bank'
        and f.deleted_at is null
        and f.year_id is not null
        and public.admin_can_access_year(f.year_id)
    );
$$;

comment on function public.can_admin_manage_mcq_bank_material_folder(uuid) is
  'True when caller has edit_questions and assigned-class access to a live mcq_bank material folder. Does not grant general materials admin.';

revoke execute on function public.can_admin_manage_mcq_bank_material_folder(uuid)
  from public, anon;
grant execute on function public.can_admin_manage_mcq_bank_material_folder(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. allocate_study_object_key(folder) — scoped; zero-arg stays manage_materials
-- ---------------------------------------------------------------------------
drop function if exists public.allocate_study_object_key();

create or replace function public.allocate_study_object_key(
  p_folder_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_folder_id is null then
    perform public.require_permission('manage_materials');
  else
    if not (
      public.has_permission('manage_materials')
      or public.can_admin_manage_mcq_bank_material_folder(p_folder_id)
    ) then
      if not public.is_admin() then
        raise exception 'admin only';
      end if;
      raise exception 'permission_denied';
    end if;
  end if;

  return format(
    'study-content/%s/%s/%s',
    public.default_tenant()::text,
    v_uid::text,
    gen_random_uuid()::text
  );
end;
$$;

comment on function public.allocate_study_object_key(uuid) is
  'Allocate private study-content R2 key. Null folder: manage_materials only. With folder: manage_materials OR edit_questions on live mcq_bank folder in assigned class.';

revoke execute on function public.allocate_study_object_key(uuid) from public, anon;
grant execute on function public.allocate_study_object_key(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. authorize_study_object — mcq_bank editors may preview/open their PDFs
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

  if public.has_permission('manage_materials') then
    return v_key;
  end if;

  -- Academic MCQ Bank editors (edit_questions + class year): draft or published
  if public.can_admin_manage_mcq_bank_material_folder(v_folder_id) then
    if v_deleted is not null or v_folder_deleted is not null then
      raise exception 'study_object_denied';
    end if;
    return v_key;
  end if;

  if v_deleted is not null or v_folder_deleted is not null then
    raise exception 'study_object_denied';
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

revoke execute on function public.authorize_study_object(uuid) from public, anon;
grant execute on function public.authorize_study_object(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. authorize_study_object_discard — edit_questions may discard own keys
-- ---------------------------------------------------------------------------
create or replace function public.authorize_study_object_discard(p_object_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_prefix text;
begin
  if p_object_key is null
     or p_object_key !~ '^study-content/'
     or p_object_key ~ '[[:space:]]' then
    raise exception 'study_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    return p_object_key;
  end if;

  -- Orphan cleanup after failed MCQ Bank upload: own uid segment only.
  if v_uid is not null
     and public.has_permission('edit_questions') then
    v_prefix := format(
      'study-content/%s/%s/',
      public.default_tenant()::text,
      v_uid::text
    );
    if left(p_object_key, length(v_prefix)) = v_prefix then
      return p_object_key;
    end if;
  end if;

  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  raise exception 'permission_denied';
end;
$$;

revoke execute on function public.authorize_study_object_discard(text)
  from public, anon;
grant execute on function public.authorize_study_object_discard(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin SELECT: edit_questions may list mcq_bank folders + their materials
-- ---------------------------------------------------------------------------
drop policy if exists materials_admin_select on public.materials;
create policy materials_admin_select on public.materials
  for select using (
    public.can_admin_select_materials()
    or public.can_admin_manage_mcq_bank_material_folder(folder_id)
  );

drop policy if exists material_folders_admin_select on public.material_folders;
create policy material_folders_admin_select on public.material_folders
  for select using (
    public.can_admin_select_materials()
    or (
      public.has_permission('edit_questions')
      and library_type = 'mcq_bank'
      and year_id is not null
      and public.admin_can_access_year(year_id)
    )
  );
