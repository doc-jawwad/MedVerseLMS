-- Issue #11: class revocation must really delete the old assignments.
-- A BEFORE DELETE trigger returning NEW silently suppresses the deletion.
create or replace function public.protect_admin_year_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.admin_year_assignment_rpc', true) is distinct from '1' then
    raise exception 'admin_year_assignment_rpc_only';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- A demoted/reused identity must not inherit a previous administrator's
-- classes. The existing role guard still controls who may change role.
-- This trigger can only remove assignments from the row changing role.
create or replace function public.clear_admin_years_on_role_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_previous text := current_setting('medverse.admin_year_assignment_rpc', true);
begin
  if old.role is distinct from new.role
     and (old.role = 'admin' or new.role = 'admin') then
    perform set_config('medverse.admin_year_assignment_rpc', '1', true);
    delete from public.admin_year_assignments where admin_id = new.id;
    perform set_config('medverse.admin_year_assignment_rpc', coalesce(v_previous, ''), true);
  end if;
  return new;
end;
$$;
revoke all on function public.clear_admin_years_on_role_change() from public, anon, authenticated, service_role;
create trigger profiles_clear_admin_years_on_role_change
after update of role on public.profiles
for each row
when (old.role is distinct from new.role)
execute function public.clear_admin_years_on_role_change();

-- Serialize assignment replacement with profile role transitions. Preserve
-- the existing permission checks, exact requested set, audit and grants.
create or replace function public.set_admin_year_assignments(
  p_admin_id uuid,
  p_year_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_year_ids, '{}');
  v_id uuid;
begin
  perform public.require_permission('manage_admins');

  perform 1 from public.profiles
  where id = p_admin_id and role = 'admin'
  for update;
  if not found then
    raise exception 'admin_not_found';
  end if;

  foreach v_id in array v_ids loop
    if not exists (select 1 from public.years where id = v_id) then
      raise exception 'invalid_year';
    end if;
  end loop;

  perform set_config('medverse.admin_year_assignment_rpc', '1', true);

  delete from public.admin_year_assignments
  where admin_id = p_admin_id;

  insert into public.admin_year_assignments (admin_id, year_id)
  select p_admin_id, unnest(v_ids)
  on conflict (admin_id, year_id) do nothing;

  perform set_config('medverse.admin_year_assignment_rpc', '', true);

  perform public.log_audit(
    'admin_year_assignments_set',
    'admin',
    p_admin_id,
    jsonb_build_object('year_ids', to_jsonb(v_ids))
  );
exception
  when others then
    perform set_config('medverse.admin_year_assignment_rpc', '', true);
    raise;
end;
$$;

-- No historical grants are modified automatically. Reconcile legacy drift
-- against verified owner-approved assignments before production activation.
notify pgrst, 'reload schema';
