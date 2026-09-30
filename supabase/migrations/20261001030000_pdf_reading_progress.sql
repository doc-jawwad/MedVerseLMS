-- Persistent per-student PDF reading position (last page).
-- One row per (student_id, material_id). Debounced client upserts — not an event log.

create table public.pdf_reading_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  page_number int not null check (page_number >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pdf_reading_progress_student_material_uidx
    unique (student_id, material_id)
);

create index pdf_reading_progress_owner_material_idx
  on public.pdf_reading_progress (student_id, material_id);

create trigger pdf_reading_progress_updated_at
  before update on public.pdf_reading_progress
  for each row execute function public.set_updated_at();

comment on table public.pdf_reading_progress is
  'Private last-read PDF page. Scoped to (student_id, material_id). Not an event log.';

alter table public.pdf_reading_progress enable row level security;

create policy pdf_reading_progress_select_own on public.pdf_reading_progress
  for select using (
    student_id = (select auth.uid())
  );

create policy pdf_reading_progress_insert_own on public.pdf_reading_progress
  for insert with check (
    student_id = (select auth.uid())
    and public.can_annotate_pdf(material_id)
  );

create policy pdf_reading_progress_update_own on public.pdf_reading_progress
  for update using (
    student_id = (select auth.uid())
  ) with check (
    student_id = (select auth.uid())
    and public.can_annotate_pdf(material_id)
  );

create policy pdf_reading_progress_delete_own on public.pdf_reading_progress
  for delete using (
    student_id = (select auth.uid())
  );

grant select, insert, update, delete on public.pdf_reading_progress to authenticated;
grant all on public.pdf_reading_progress to service_role;
