-- 0011: study materials — folders of Google Drive links (no file storage)

create table public.material_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  year_id uuid not null references public.years (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  folder_id uuid not null references public.material_folders (id) on delete cascade,
  title text not null,
  description text not null default '',
  file_type text not null default 'pdf',
  drive_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index material_folders_year_idx on public.material_folders (year_id);
create index materials_folder_idx on public.materials (folder_id);

create trigger material_folders_updated_at before update on public.material_folders
  for each row execute function public.set_updated_at();
create trigger materials_updated_at before update on public.materials
  for each row execute function public.set_updated_at();

-- FK for the existing access_grants.folder_id target
alter table public.access_grants
  add constraint access_grants_folder_fk
  foreign key (folder_id) references public.material_folders (id) on delete cascade;

alter table public.material_folders enable row level security;
alter table public.materials enable row level security;

create policy material_folders_admin_all on public.material_folders
  for all using (public.is_admin()) with check (public.is_admin());
create policy materials_admin_all on public.materials
  for all using (public.is_admin()) with check (public.is_admin());

-- Students: folders in their active enrollment year, or explicitly granted.
create policy material_folders_student_select on public.material_folders
  for select using (
    public.has_active_enrollment(year_id)
    or exists (
      select 1 from public.access_grants g
      where g.student_id = (select auth.uid())
        and g.grant_type = 'materials_folder'
        and g.folder_id = material_folders.id
        and g.revoked_at is null
    )
  );

create policy materials_student_select on public.materials
  for select using (
    exists (
      select 1 from public.material_folders f
      where f.id = materials.folder_id
        and (
          public.has_active_enrollment(f.year_id)
          or exists (
            select 1 from public.access_grants g
            where g.student_id = (select auth.uid())
              and g.grant_type = 'materials_folder'
              and g.folder_id = f.id
              and g.revoked_at is null
          )
        )
    )
  );
