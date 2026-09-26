-- Persistent per-student PDF text highlights (USER + MATERIAL scoped).
-- Rects are PDF page user-space coordinates (scale/rotation stable).
-- Never shared across students; entitlement checked on write.

create table public.pdf_highlights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  page_number int not null check (page_number >= 1),
  rects jsonb not null,
  selected_text text not null default '',
  color text not null default '#fde047'
    check (char_length(color) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pdf_highlights_rects_array check (jsonb_typeof(rects) = 'array'),
  constraint pdf_highlights_rects_nonempty check (jsonb_array_length(rects) >= 1),
  constraint pdf_highlights_selected_text_len check (char_length(selected_text) <= 4000)
);

create index pdf_highlights_owner_material_idx
  on public.pdf_highlights (student_id, material_id, page_number);

create index pdf_highlights_material_idx
  on public.pdf_highlights (material_id);

create trigger pdf_highlights_updated_at
  before update on public.pdf_highlights
  for each row execute function public.set_updated_at();

comment on table public.pdf_highlights is
  'Private PDF text highlights. Scoped to (student_id, material_id). Rects in PDF user space.';

comment on column public.pdf_highlights.rects is
  'JSON array of {x1,y1,x2,y2} in PDF page user space (origin bottom-left). Stable across zoom.';

alter table public.pdf_highlights enable row level security;

-- True when the caller may annotate this published PDF (folder content entitlement).
create or replace function public.can_annotate_pdf(p_material_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder_id uuid;
  v_kind text;
  v_status text;
  v_key text;
  v_deleted timestamptz;
begin
  if p_material_id is null then
    return false;
  end if;

  if public.has_permission('manage_materials') then
    select folder_id, kind, status, r2_object_key, deleted_at
      into v_folder_id, v_kind, v_status, v_key, v_deleted
    from public.materials
    where id = p_material_id;
    return found
      and v_deleted is null
      and v_kind = 'pdf'
      and v_key is not null;
  end if;

  select folder_id, kind, status, r2_object_key, deleted_at
    into v_folder_id, v_kind, v_status, v_key, v_deleted
  from public.materials
  where id = p_material_id;

  if not found then
    return false;
  end if;
  if v_deleted is not null then
    return false;
  end if;
  if v_kind is distinct from 'pdf' or v_key is null then
    return false;
  end if;
  if v_status is distinct from 'published' then
    return false;
  end if;
  return public.can_access_material_folder(v_folder_id);
end;
$$;

revoke execute on function public.can_annotate_pdf(uuid) from public, anon;
grant execute on function public.can_annotate_pdf(uuid) to authenticated, service_role;

create policy pdf_highlights_select_own on public.pdf_highlights
  for select using (
    student_id = (select auth.uid())
    or public.has_permission('view_students')
  );

create policy pdf_highlights_insert_own on public.pdf_highlights
  for insert with check (
    student_id = (select auth.uid())
    and public.can_annotate_pdf(material_id)
  );

create policy pdf_highlights_update_own on public.pdf_highlights
  for update using (
    student_id = (select auth.uid())
  ) with check (
    student_id = (select auth.uid())
    and public.can_annotate_pdf(material_id)
  );

create policy pdf_highlights_delete_own on public.pdf_highlights
  for delete using (
    student_id = (select auth.uid())
  );

grant select, insert, update, delete on public.pdf_highlights to authenticated;
grant all on public.pdf_highlights to service_role;
