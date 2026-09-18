-- Staging-only login role for PostgREST. Idempotent.
-- Does not create, drop, or alter production `authenticator`.
-- Cluster roles anon / authenticated / service_role already exist on the VPS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator_staging') then
    create role authenticator_staging noinherit login;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator_staging;
