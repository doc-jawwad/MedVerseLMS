-- 0002: profiles, role protection, session policy helpers (docs/permissions.md)

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null default public.default_tenant(),
  full_name text not null default '',
  email text not null default '',
  role text not null default 'student' check (role in ('admin', 'student')),
  active_session_id uuid,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- role helper (SECURITY DEFINER so RLS policies can call it without recursion)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- profile auto-creation on signup; role is always student here.
-- Admins are promoted only via SQL/service role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users must never change their own role (docs/permissions.md).
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role changes require admin';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- Layer 1 portal session: newest login wins (docs/permissions.md).
create or replace function public.register_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set active_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid,
      last_login_at = now()
  where id = (select auth.uid());
end;
$$;

-- Session validity. v1: portal check only. Phase 7 REPLACES this function to add
-- the live-attempt exemption (a session owning an in_progress attempt stays valid).
create or replace function public.is_active_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and active_session_id is not distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid
  );
$$;

-- RLS
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (id = (select auth.uid()) or public.is_admin());

create policy profiles_update_own on public.profiles
  for update using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- no INSERT/DELETE policies: inserts happen via the definer trigger, deletes via service role only.
