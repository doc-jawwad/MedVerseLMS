-- Private per-owner PDF ink; never reuse the staff-visible highlight policy.
-- Apply after the approved MCQ folder-entitlement and privacy migrations.
-- Coordinates are PDF user-space points, independent of zoom and rotation.
create function public.pdf_ink_revision(p_material_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if auth.uid() is null or p_material_id is null then return null; end if;
  -- Same canonical active-session, material, folder, class and entitlement gate
  -- as the protected reader. Do not return the storage object key.
  v_key := public.authorize_study_object(p_material_id);
  return case when v_key is not null then md5(v_key) else null end;
exception when raise_exception then
  if sqlerrm = 'study_object_denied' then return null; end if;
  raise;
end;
$$;

revoke all on function public.pdf_ink_revision(uuid) from public, anon, authenticated, service_role;
grant execute on function public.pdf_ink_revision(uuid) to authenticated;

create function public.pdf_ink_points_valid(p_points jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_point jsonb;
begin
  if jsonb_typeof(p_points) <> 'array' then return false; end if;
  if jsonb_array_length(p_points) not between 1 and 512 then return false; end if;
  for v_point in select value from jsonb_array_elements(p_points) loop
    if jsonb_typeof(v_point) <> 'array' then return false; end if;
    if jsonb_array_length(v_point) <> 2 then return false; end if;
    if jsonb_typeof(v_point->0) <> 'number' or jsonb_typeof(v_point->1) <> 'number' then return false; end if;
    if abs((v_point->>0)::numeric) > 1000000 or abs((v_point->>1)::numeric) > 1000000 then return false; end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.pdf_ink_points_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.pdf_ink_points_valid(jsonb) to authenticated;

create table public.pdf_ink_strokes (
  id uuid primary key,
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  content_revision text not null check (content_revision ~ '^[0-9a-f]{32}$'),
  page_number integer not null check (page_number between 1 and 100000),
  points jsonb not null check (public.pdf_ink_points_valid(points)),
  color text not null check (color in ('#dc2626', '#2563eb', '#111827', '#16a34a')),
  width numeric(4,2) not null check (width between 0.5 and 12),
  created_at timestamptz not null default now()
);
create index pdf_ink_strokes_owner_page_idx
  on public.pdf_ink_strokes (student_id, material_id, content_revision, page_number, created_at, id);
create index pdf_ink_strokes_material_idx on public.pdf_ink_strokes(material_id);

alter table public.pdf_ink_strokes enable row level security;
-- Explicitly exclude any default grants; clients cannot set owner, tenant or timestamp,
-- and cannot modify strokes in place. No staff override.
revoke all on public.pdf_ink_strokes from public, anon, authenticated, service_role;
grant select, delete on public.pdf_ink_strokes to authenticated;
grant insert (id, material_id, content_revision, page_number, points, color, width)
  on public.pdf_ink_strokes to authenticated;

create policy pdf_ink_read_own on public.pdf_ink_strokes for select to authenticated
using (
  case when student_id = (select auth.uid()) and tenant_id = (select public.default_tenant())
  then content_revision = public.pdf_ink_revision(material_id)
  else false end
);
create policy pdf_ink_insert_own on public.pdf_ink_strokes for insert to authenticated
with check (
  case when student_id = (select auth.uid()) and tenant_id = (select public.default_tenant())
  then content_revision = public.pdf_ink_revision(material_id)
  else false end
);
create policy pdf_ink_delete_own on public.pdf_ink_strokes for delete to authenticated
using (
  case when student_id = (select auth.uid()) and tenant_id = (select public.default_tenant())
  then content_revision = public.pdf_ink_revision(material_id)
  else false end
);

comment on table public.pdf_ink_strokes is
  'Private immutable PDF pen strokes for the current authorized object revision; no staff read override.';

-- Bind the expected actor to the same authenticated request as the insert.
-- SECURITY INVOKER retains the table's existing grants and RLS; this is not
-- an elevated write path. The caller cannot set student_id or tenant_id.
create function public.save_pdf_ink_stroke(
  p_expected_owner uuid, p_id uuid, p_material_id uuid,
  p_content_revision text, p_page_number integer, p_points jsonb,
  p_color text, p_width numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.pdf_ink_strokes;
begin
  if auth.uid() is null or auth.uid() is distinct from p_expected_owner then
    raise exception using errcode = '42501', message = 'pdf_ink_actor_mismatch';
  end if;
  insert into public.pdf_ink_strokes(id, material_id, content_revision, page_number, points, color, width)
  values (p_id, p_material_id, p_content_revision, p_page_number, p_points, p_color, p_width)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.save_pdf_ink_stroke(uuid, uuid, uuid, text, integer, jsonb, text, numeric) from public, anon, authenticated, service_role;
grant execute on function public.save_pdf_ink_stroke(uuid, uuid, uuid, text, integer, jsonb, text, numeric) to authenticated;
