-- Attribute new import_batches to the inserting admin and reject forged ownership.
-- Column created_by already exists (nullable); this only tightens INSERT WITH CHECK
-- and makes created_by immutable on UPDATE. Does not backfill historical NULL rows.

drop policy if exists import_batches_admin_insert on public.import_batches;
create policy import_batches_admin_insert on public.import_batches
  for insert with check (
    public.can_admin_import_questions()
    and created_by = auth.uid()
  );

comment on policy import_batches_admin_insert on public.import_batches is
  'Import-capable admins may insert batches only with created_by = auth.uid() (no spoofed owner).';

create or replace function public.tg_import_batches_created_by_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'import_batches.created_by is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists import_batches_created_by_immutable on public.import_batches;
create trigger import_batches_created_by_immutable
  before update on public.import_batches
  for each row
  execute function public.tg_import_batches_created_by_immutable();
