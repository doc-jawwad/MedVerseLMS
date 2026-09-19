-- Folder library category (Books vs Notes vs OSPE vs Lectures vs Guidelines).
-- Distinct from materials.kind, which is delivery (drive / pdf / guideline).
-- Existing data: folders that already contain a guideline item → guidelines;
-- everything else → notes so current Drive/PDF rows remain reachable.

alter table public.material_folders
  add column if not exists library_type text not null default 'notes';

alter table public.material_folders
  drop constraint if exists material_folders_library_type_check;

alter table public.material_folders
  add constraint material_folders_library_type_check
  check (library_type in (
    'guidelines',
    'ospe_material',
    'ospe_lectures',
    'books',
    'notes',
    'lectures'
  ));

update public.material_folders f
set library_type = 'guidelines'
where exists (
  select 1
  from public.materials m
  where m.folder_id = f.id
    and m.kind = 'guideline'
);

create index if not exists material_folders_year_library_idx
  on public.material_folders (year_id, library_type);

comment on column public.material_folders.library_type is
  'Student/admin library category. Delivery format stays on materials.kind.';
