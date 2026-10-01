-- M1: is_admin / has_permission respect account_status (active only).
-- M8: mcq_bank folder/subfolder admin SELECT = edit_questions + assigned year.
-- has_permission already calls is_admin(), so M1 cascades without redefining it.

-- ---------------------------------------------------------------------------
-- M1: is_admin requires active account_status
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and account_status = 'active'
  );
$$;

comment on function public.is_admin() is
  'True when caller is role=admin and account_status=active. Gates admin surface/RLS; not a substitute for has_permission.';

-- ---------------------------------------------------------------------------
-- M8: align MCQ Bank folder + subfolder admin SELECT with year-scoped write boundary
-- ---------------------------------------------------------------------------
drop policy if exists mcq_bank_folders_admin_select on public.mcq_bank_folders;
create policy mcq_bank_folders_admin_select on public.mcq_bank_folders
  for select using (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists mcq_bank_subfolders_admin_select on public.mcq_bank_subfolders;
create policy mcq_bank_subfolders_admin_select on public.mcq_bank_subfolders
  for select using (
    public.has_permission('edit_questions')
    and public.admin_can_access_year(year_id)
  );
