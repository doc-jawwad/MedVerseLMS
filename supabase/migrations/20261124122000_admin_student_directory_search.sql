-- Issue #11: bounded directory search with the existing biodata/class boundary.
-- This returns only IDs and email, never whole profiles or unrelated analytics.
create or replace function public.admin_student_directory_search(
  p_query text default '',
  p_account text default '',
  p_offset integer default 0
)
returns table (id uuid, email text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_account text := coalesce(p_account, '');
begin
  perform public.require_permission('view_students');
  if p_offset is null or p_offset < 0 or p_offset > 499950
     or length(v_query) > 254
     or v_account not in ('', 'active', 'blocked', 'restricted', 'suspended', 'deactivated', 'revoked') then
    raise exception 'invalid_directory_query';
  end if;

  return query
    select p.id, p.email
    from public.profiles p
    where p.role = 'student'
      and public.admin_can_read_student_class(p.id)
      and (
        v_account = ''
        or (v_account = 'blocked' and p.account_status in ('restricted','suspended','deactivated','revoked'))
        or p.account_status = v_account
      )
      and (
        v_query = ''
        or strpos(lower(p.full_name), v_query) > 0
        or strpos(lower(p.email), v_query) > 0
      )
    order by p.full_name asc nulls last, p.id asc
    limit 51 offset p_offset;
end;
$$;

revoke all on function public.admin_student_directory_search(text,text,integer) from public, anon, service_role;
grant execute on function public.admin_student_directory_search(text,text,integer) to authenticated;
notify pgrst, 'reload schema';
