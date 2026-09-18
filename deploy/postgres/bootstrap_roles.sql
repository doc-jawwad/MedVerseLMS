-- VPS-only role bootstrap so PostgREST can SET ROLE from the JWT `role` claim.
-- Idempotent. Do not run against Cloud hosted projects.
-- Use deploy/scripts/bootstrap-vps-db.sh, which refuses supabase.co hosts.
--
-- Table/function GRANTs stay in supabase/migrations (including later REVOKEs).
-- This file only creates the login/noinherit roles PostgREST expects.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role, authenticator;
