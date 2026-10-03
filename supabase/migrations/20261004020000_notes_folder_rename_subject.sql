-- Notes folder Rename + Change Subject.
-- Updates name and/or subject_id on a live Notes folder. Does not move materials,
-- change year/library_type/content_surface, or Bin/R2 state.

create or replace function public.admin_update_notes_folder(
  p_folder_id uuid,
  p_name text default null,
  p_subject_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.material_folders%rowtype;
  v_subject public.subjects%rowtype;
  v_name text;
  v_subject_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  if p_folder_id is null then
    raise exception 'folder_required';
  end if;
  if p_name is null and p_subject_id is null then
    raise exception 'nothing_to_update';
  end if;

  select * into v_folder
  from public.material_folders
  where id = p_folder_id
  for update;
  if not found then
    raise exception 'folder_not_found';
  end if;
  if v_folder.deleted_at is not null then
    raise exception 'folder_deleted';
  end if;
  if v_folder.library_type is distinct from 'notes' then
    raise exception 'notes_folder_only';
  end if;
  if not public.admin_can_access_year(v_folder.year_id) then
    raise exception 'year_scope_denied';
  end if;

  v_name := v_folder.name;
  v_subject_id := v_folder.subject_id;

  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' then
      raise exception 'folder_name_required';
    end if;
  end if;

  if p_subject_id is not null then
    select * into v_subject
    from public.subjects
    where id = p_subject_id;
    if not found then
      raise exception 'subject_not_found';
    end if;
    if v_subject.year_id is distinct from v_folder.year_id then
      raise exception 'notes_folder_subject_year_mismatch';
    end if;
    v_subject_id := p_subject_id;
  end if;

  if v_subject_id is null then
    raise exception 'notes_folder_subject_required';
  end if;

  update public.material_folders
  set
    name = v_name,
    subject_id = v_subject_id
  where id = p_folder_id
    and deleted_at is null
    and library_type = 'notes';

  if not found then
    raise exception 'notes_folder_update_failed';
  end if;

  select * into v_folder
  from public.material_folders
  where id = p_folder_id;

  return jsonb_build_object(
    'folder_id', v_folder.id,
    'name', v_folder.name,
    'subject_id', v_folder.subject_id,
    'year_id', v_folder.year_id,
    'library_type', v_folder.library_type,
    'content_surface', v_folder.content_surface,
    'deleted_at', v_folder.deleted_at
  );
end;
$$;

revoke all on function public.admin_update_notes_folder(uuid, text, uuid) from public, anon;
grant execute on function public.admin_update_notes_folder(uuid, text, uuid) to authenticated, service_role;

comment on function public.admin_update_notes_folder(uuid, text, uuid) is
  'Rename and/or change subject on a live Notes folder. Subject must share folder year_id. Requires manage_materials + admin_can_access_year. Does not alter materials, year, library_type, content_surface, or Bin/R2.';
