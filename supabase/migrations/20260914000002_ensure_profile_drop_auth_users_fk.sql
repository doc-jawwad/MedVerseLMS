-- VPS Auth/DB split (docs/architecture.md, docs/permissions.md).
--
-- Cloud Auth INSERT cannot fire a trigger on VPS Postgres. profiles.id stays
-- equal to the Auth JWT sub, but must not FK/cascade to auth.users (that table
-- is not on the VPS). handle_new_user() remains in the chain for a return to
-- managed Supabase; it is made idempotent so it is safe alongside ensure_profile().

alter table public.profiles drop constraint if exists profiles_id_fkey;

-- Idempotent profile + pending-enrollment provisioner. JWT subject is the
-- profile UUID. Safe to call on every signup/verify/login.
create or replace function public.ensure_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (select auth.uid());
  v_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  v_meta jsonb;
  v_email text;
  v_name text;
  v_year uuid;
begin
  if v_id is null then
    raise exception 'not authenticated';
  end if;

  v_meta := coalesce(v_claims -> 'user_metadata', '{}'::jsonb);
  if jsonb_typeof(v_meta) <> 'object' then
    v_meta := '{}'::jsonb;
  end if;

  v_email := coalesce(v_claims ->> 'email', '');
  v_name := coalesce(v_meta ->> 'full_name', '');

  insert into public.profiles (id, email, full_name)
  values (v_id, v_email, v_name)
  on conflict (id) do update
    set email = case when excluded.email <> '' then excluded.email else public.profiles.email end,
        full_name = case
          when excluded.full_name <> '' then excluded.full_name
          else public.profiles.full_name
        end;
  -- role is never written here (insert default 'student'; updates skip it).

  begin
    v_year := nullif(v_meta ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select v_id, v_year, 'pending'
    where not exists (
      select 1 from public.enrollments
      where student_id = v_id and status in ('pending', 'active')
    );
  end if;
end;
$$;

-- Keep handle_new_user() for managed-Supabase portability. Make it safe if
-- ensure_profile() already created the row (ON CONFLICT / existing enrollment).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  v_year := nullif(new.raw_user_meta_data ->> 'year_id', '')::uuid;
  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select new.id, v_year, 'pending'
    where not exists (
      select 1 from public.enrollments
      where student_id = new.id and status in ('pending', 'active')
    );
  end if;

  return new;
end;
$$;

-- Authenticated students/admins must be able to provision their own profile.
-- Anon must not. Nested/internal calls are not required.
revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated, service_role;
