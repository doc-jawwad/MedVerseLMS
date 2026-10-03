-- Leaderboard college display: promote registration college into profiles.
--
-- Root cause: signup stores college_name in Auth user_metadata only.
-- test_leaderboard_projection reads public.profiles.college_name, which
-- ensure_profile / handle_new_user never populated after Data Spine added
-- the column. Profile UI masked the gap via a metadata fallback; the
-- leaderboard correctly does not (and must not) read other users' Auth meta.
--
-- Fix:
-- 1) ensure_profile copies college_name from JWT user_metadata into profiles
--    on insert, and heals null/blank profiles.college_name on later calls
--    without overwriting a student-edited profiles.college_name.
-- 2) handle_new_user does the same on co-located Auth insert.
-- 3) One-time backfill from auth.users when that schema is present.

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
  v_college text;
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
  v_college := nullif(btrim(coalesce(v_meta ->> 'college_name', '')), '');

  insert into public.profiles (id, email, full_name, college_name)
  values (v_id, v_email, v_name, v_college)
  on conflict (id) do update
    set email = case when excluded.email <> '' then excluded.email else public.profiles.email end,
        full_name = case
          when excluded.full_name <> '' then excluded.full_name
          else public.profiles.full_name
        end,
        -- Heal registration college into the leaderboard-authoritative column.
        -- Never overwrite a non-empty profiles.college_name (profile edit wins).
        college_name = case
          when nullif(btrim(coalesce(public.profiles.college_name, '')), '') is null
            then excluded.college_name
          else public.profiles.college_name
        end;
  -- role, account_status, is_main_admin are never written here.

  begin
    v_year := nullif(v_meta ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  -- Self-service year choice is first provision only. Any historical enrollment
  -- (expired/revoked/suspended/active) means later year changes are admin-mediated.
  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select v_id, v_year, 'active'
    where not exists (
      select 1 from public.enrollments
      where student_id = v_id
    );
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year uuid;
  v_college text;
begin
  v_college := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'college_name', '')), '');

  insert into public.profiles (id, email, full_name, college_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_college
  )
  on conflict (id) do update
    set college_name = case
      when nullif(btrim(coalesce(public.profiles.college_name, '')), '') is null
        then excluded.college_name
      else public.profiles.college_name
    end;

  begin
    v_year := nullif(new.raw_user_meta_data ->> 'year_id', '')::uuid;
  exception when invalid_text_representation then
    v_year := null;
  end;

  if v_year is not null and exists (select 1 from public.years where id = v_year) then
    insert into public.enrollments (student_id, year_id, status)
    select new.id, v_year, 'active'
    where not exists (
      select 1 from public.enrollments
      where student_id = new.id
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated, service_role;

comment on function public.ensure_profile() is
  'Idempotent profile + first enrollment provision from JWT. Copies full_name and college_name from user_metadata; heals blank profiles.college_name without overwriting an existing college; year_id enrollment only when the subject has never had an enrollments row.';

-- One-time backfill when Auth is co-located (managed Supabase / local).
-- On Auth/DB-split VPS hosts without auth.users, ensure_profile heal on next
-- sign-in / verify is the promotion path.
do $$
begin
  if to_regclass('auth.users') is null then
    return;
  end if;

  update public.profiles p
  set
    college_name = nullif(btrim(u.raw_user_meta_data ->> 'college_name'), ''),
    updated_at = now()
  from auth.users u
  where u.id = p.id
    and nullif(btrim(coalesce(p.college_name, '')), '') is null
    and nullif(btrim(coalesce(u.raw_user_meta_data ->> 'college_name', '')), '') is not null;
end;
$$;
