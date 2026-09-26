-- Seal EXECUTE privileges on admin_list_mcq_bank_folders after DROP/CREATE
-- in 20260926150000 restored default PUBLIC EXECUTE.
-- Function body unchanged. Intended callers: authenticated (admin JWT via
-- PostgREST) and service_role. Match grants from 20260924180000.

revoke execute on function public.admin_list_mcq_bank_folders(uuid) from public, anon;
grant execute on function public.admin_list_mcq_bank_folders(uuid) to authenticated, service_role;
