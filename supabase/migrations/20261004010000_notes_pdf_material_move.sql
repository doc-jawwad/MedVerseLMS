-- Notes PDF Move: relocate a live Notes PDF between live Notes folders.
-- Updates materials.folder_id only. Preserves material id + r2_object_key.
-- Does not soft-delete, restore, re-upload, or enqueue R2 purge.

create or replace function public.admin_move_notes_pdf_material(
  p_material_id uuid,
  p_dest_folder_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.materials%rowtype;
  v_src public.material_folders%rowtype;
  v_dst public.material_folders%rowtype;
  v_key_before text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  if p_material_id is null or p_dest_folder_id is null then
    raise exception 'material_and_folder_required';
  end if;

  select * into v_mat
  from public.materials
  where id = p_material_id
  for update;
  if not found then
    raise exception 'material_not_found';
  end if;
  if v_mat.deleted_at is not null then
    raise exception 'material_deleted';
  end if;
  if v_mat.kind is distinct from 'pdf' then
    raise exception 'notes_move_pdf_only';
  end if;
  if v_mat.folder_id is null then
    raise exception 'material_folder_required';
  end if;
  if v_mat.folder_id = p_dest_folder_id then
    raise exception 'same_folder';
  end if;

  select * into v_src
  from public.material_folders
  where id = v_mat.folder_id;
  if not found then
    raise exception 'source_folder_not_found';
  end if;
  if v_src.deleted_at is not null then
    raise exception 'source_folder_deleted';
  end if;
  if v_src.library_type is distinct from 'notes' then
    raise exception 'notes_move_source_not_notes';
  end if;
  if not public.admin_can_access_year(v_src.year_id) then
    raise exception 'year_scope_denied';
  end if;

  select * into v_dst
  from public.material_folders
  where id = p_dest_folder_id;
  if not found then
    raise exception 'destination_folder_not_found';
  end if;
  if v_dst.deleted_at is not null then
    raise exception 'destination_folder_deleted';
  end if;
  if v_dst.library_type is distinct from 'notes' then
    raise exception 'notes_move_library_type_mismatch';
  end if;
  if v_dst.content_surface is distinct from v_src.content_surface then
    raise exception 'notes_move_content_surface_mismatch';
  end if;
  if v_dst.year_id is distinct from v_src.year_id then
    raise exception 'notes_move_year_mismatch';
  end if;
  if not public.admin_can_access_year(v_dst.year_id) then
    raise exception 'year_scope_denied';
  end if;

  v_key_before := v_mat.r2_object_key;

  update public.materials
  set folder_id = p_dest_folder_id
  where id = p_material_id
    and deleted_at is null
    and folder_id = v_src.id;

  if not found then
    raise exception 'notes_move_failed';
  end if;

  select * into v_mat
  from public.materials
  where id = p_material_id;

  if v_mat.folder_id is distinct from p_dest_folder_id then
    raise exception 'notes_move_failed';
  end if;
  if v_mat.r2_object_key is distinct from v_key_before then
    raise exception 'notes_move_r2_key_changed';
  end if;
  if v_mat.deleted_at is not null then
    raise exception 'notes_move_bin_state_changed';
  end if;

  return jsonb_build_object(
    'material_id', v_mat.id,
    'folder_id', v_mat.folder_id,
    'source_folder_id', v_src.id,
    'r2_object_key', v_mat.r2_object_key,
    'deleted_at', v_mat.deleted_at
  );
end;
$$;

revoke all on function public.admin_move_notes_pdf_material(uuid, uuid) from public, anon;
grant execute on function public.admin_move_notes_pdf_material(uuid, uuid) to authenticated, service_role;

comment on function public.admin_move_notes_pdf_material(uuid, uuid) is
  'Move a live Notes PDF to another live Notes folder (same year + content_surface). Updates folder_id only; preserves id and r2_object_key. Requires manage_materials + admin_can_access_year.';
