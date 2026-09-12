-- 0007: allow role changes from service role / direct SQL (auth.uid() is null there).
-- End users still cannot change roles unless they are already admin.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and not public.is_admin() then
    raise exception 'role changes require admin';
  end if;
  return new;
end;
$$;
