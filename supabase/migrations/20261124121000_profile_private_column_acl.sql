revoke select on table public.profiles from public, anon, authenticated;
revoke select (id, tenant_id, full_name, email, role, created_at, updated_at,
  active_session_id, account_status, is_main_admin, last_login_at, college_name,
  avatar_object_key) on public.profiles from public, anon, authenticated;

-- The promotion selector must not rely on an email writable over REST.
-- Auth-backed ensure_profile continues to sync email through its definer.
revoke update on table public.profiles from public, anon, authenticated;
revoke update (email) on public.profiles from public, anon, authenticated;
grant update (id, tenant_id, full_name, role, created_at, updated_at,
  active_session_id, account_status, is_main_admin, last_login_at, college_name,
  avatar_object_key) on public.profiles to authenticated;

grant select (id, full_name, role, account_status, is_main_admin,
  created_at) on public.profiles to authenticated;

-- Fail closed if a local role membership or a newly added column would
-- silently retain effective private access after the revokes.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_attribute a
    cross join (values ('authenticated'), ('anon')) as r(name)
    where a.attrelid = 'public.profiles'::regclass and a.attnum > 0
      and not a.attisdropped
      and (r.name = 'anon' or a.attname not in
        ('id', 'full_name', 'role', 'account_status', 'is_main_admin', 'created_at'))
      and pg_catalog.has_column_privilege(r.name, a.attrelid, a.attnum, 'SELECT')
  ) then
    raise exception 'Unexpected effective SELECT grant on profiles';
  end if;
  if pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
     or pg_catalog.has_column_privilege('anon', 'public.profiles', 'email', 'UPDATE') then
    raise exception 'Unexpected effective UPDATE grant on profiles.email';
  end if;
end;
$$;

notify pgrst, 'reload schema';
