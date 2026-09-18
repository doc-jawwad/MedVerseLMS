-- pgTAP-only compatibility for the VPS Auth stub.
--
-- Cloud/local Supabase auth.users has GoTrue columns such as instance_id,
-- aud, encrypted_password, and timestamps. The VPS database intentionally
-- keeps only the columns needed by the Cloud-Auth split:
--   id, email, raw_user_meta_data.
--
-- The canonical 000_helpers.sql fixture factories insert a full GoTrue row
-- so handle_new_user() creates public.profiles. On the VPS stub those inserts
-- fail before the trigger can run. Override only test_helpers factories with
-- the equivalent resulting public.profiles rows. Product schemas, RLS,
-- functions, and Auth behavior are not changed. Suite fixtures still live
-- inside each suite's BEGIN/ROLLBACK.

create or replace function test_helpers.make_student(
  p_year_id uuid,
  p_name text default 'Test Student'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform test_helpers.as_runner();
  insert into public.profiles (
    id, email, full_name, role, account_status, is_main_admin
  )
  values (
    v_id, v_id || '@test.invalid', p_name, 'student', 'active', false
  );
  insert into public.enrollments (student_id, year_id, status)
  values (v_id, p_year_id, 'active');
  return v_id;
end;
$$;

create or replace function test_helpers.make_admin(
  p_name text default 'Test Admin'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform test_helpers.as_runner();
  insert into public.profiles (
    id, email, full_name, role, account_status, is_main_admin
  )
  values (
    v_id, v_id || '@test.invalid', p_name, 'admin', 'active', true
  );
  return v_id;
end;
$$;

create or replace function test_helpers.make_limited_admin(
  p_name text default 'Limited Admin',
  p_codes text[] default '{}'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform test_helpers.as_runner();
  insert into public.profiles (
    id, email, full_name, role, account_status, is_main_admin
  )
  values (
    v_id, v_id || '@test.invalid', p_name, 'admin', 'active', false
  );
  insert into public.admin_permissions (admin_id, permission_code)
  select v_id, c
  from unnest(coalesce(p_codes, '{}')) as c
  where c is not null and btrim(c) <> '';
  return v_id;
end;
$$;

grant execute on function test_helpers.make_student(uuid, text)
  to anon, authenticated;
grant execute on function test_helpers.make_admin(text)
  to anon, authenticated;
grant execute on function test_helpers.make_limited_admin(text, text[])
  to anon, authenticated;
