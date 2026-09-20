-- Restore authenticated DML grants for ospe_stations and postgres default privileges.
-- Staging applied 20260920053838 as postgres, but host default privileges for tables
-- were missing (only function EXECUTE remained), so authenticated had column SELECT
-- only and INSERT failed with "permission denied for table ospe_stations".
-- Matches 20260912000006_grants.sql intent; RLS still governs row access.

grant select, insert, update, delete on public.ospe_stations to authenticated;
grant all on public.ospe_stations to service_role;

-- Keep answer / R2 columns out of direct student SELECT (catalog metadata only).
revoke select on public.ospe_stations from public;
revoke select on public.ospe_stations from anon;
revoke select on public.ospe_stations from authenticated;
grant select (
  id,
  tenant_id,
  title,
  year_id,
  subject_id,
  status,
  entitlement,
  required_plan_id,
  sort_order,
  created_at,
  updated_at
) on public.ospe_stations to authenticated;

-- Re-assert platform default privileges for future objects created by postgres.
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to authenticated, service_role;
