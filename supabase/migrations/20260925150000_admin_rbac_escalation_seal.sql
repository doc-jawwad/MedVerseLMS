-- Staging RBAC escalation seal (do not apply to production baseline 20260924130000
-- until staging QA signs off). Complements 20260925140000 (RPC Main Admin gate +
-- publish_tests typo). This migration closes the remaining paths:
-- 1) protect_profile_gated_columns: is_main_admin flip requires Main Admin (not
--    manage_admins alone) — blocks direct PostgREST UPDATE escalation.
-- 2) set_admin_role: demoting a Main Admin requires caller Main Admin.
-- 3) manage_curriculum permission + curriculum write RLS (SELECT stays is_admin).
-- 4) bootstrap_first_main_admin: advisory lock + active account check.

-- ---------------------------------------------------------------------------
-- Permission catalog: curriculum writes
-- ---------------------------------------------------------------------------
insert into public.permissions (code, label) values
  ('manage_curriculum', 'Manage curriculum tree')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- is_main_admin column: Main Admin (or bootstrap / service) only
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_gated_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_main_admin is distinct from old.is_main_admin then
    if current_setting('medverse.bootstrap_first_main_admin', true) is distinct from '1'
       and (select auth.uid()) is not null
       and not public.is_main_admin() then
      if not public.is_admin() then
        raise exception 'is_main_admin changes require Main Admin';
      else
        raise exception 'main_admin_required';
      end if;
    end if;
    if old.is_main_admin and not new.is_main_admin
       and not exists (
         select 1 from public.profiles
         where is_main_admin and id != old.id
       ) then
      raise exception 'cannot demote the last Main Admin';
    end if;
  end if;

  if new.account_status is distinct from old.account_status then
    if (select auth.uid()) is not null
       and current_setting('medverse.set_account_status', true) is distinct from '1' then
      raise exception 'account_status changes require set_account_status()';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.protect_profile_gated_columns() is
  'Guards is_main_admin and account_status. is_main_admin flips require bootstrap GUC, null auth.uid (service/runner), or caller is_main_admin(). manage_admins alone is insufficient.';

-- Role changes stay manage_admins (set_admin_role). Clearing is_main_admin on the
-- same UPDATE still hits protect_profile_gated_columns above.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if old.role = 'admin' and new.role is distinct from 'admin'
       and old.is_main_admin
       and not exists (
         select 1 from public.profiles
         where is_main_admin and id != old.id
       ) then
      raise exception 'cannot demote the last Main Admin';
    end if;

    if current_setting('medverse.bootstrap_first_main_admin', true) is distinct from '1'
       and (select auth.uid()) is not null
       and not public.has_permission('manage_admins') then
      if not public.is_admin() then
        raise exception 'role changes require admin';
      else
        raise exception 'permission_denied';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_admin_role: demoting a Main Admin requires caller Main Admin
-- ---------------------------------------------------------------------------
create or replace function public.set_admin_role(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_was_main boolean;
begin
  perform public.require_permission('manage_admins');

  select role, is_main_admin into v_old, v_was_main
  from public.profiles where id = p_user_id;
  if not found then
    raise exception 'profile not found';
  end if;

  if p_is_admin then
    update public.profiles
    set role = 'admin',
        is_main_admin = false
    where id = p_user_id;
    perform public.log_audit(
      'admin_role_granted',
      'profile',
      p_user_id,
      jsonb_build_object('from', v_old, 'to', 'admin')
    );
  else
    if v_was_main and not public.is_main_admin() then
      raise exception 'main_admin_required';
    end if;
    if v_was_main
       and not exists (
         select 1 from public.profiles
         where is_main_admin and id != p_user_id
       ) then
      raise exception 'cannot demote the last Main Admin';
    end if;
    delete from public.admin_permissions where admin_id = p_user_id;
    update public.profiles
    set role = 'student',
        is_main_admin = false
    where id = p_user_id;
    perform public.log_audit(
      'admin_role_revoked',
      'profile',
      p_user_id,
      jsonb_build_object('from', v_old, 'to', 'student')
    );
  end if;
end;
$$;

comment on function public.set_admin_role(uuid, boolean) is
  'Promote/demote admin role. manage_admins required. Demoting a Main Admin additionally requires caller Main Admin. Last Main Admin cannot be demoted.';

-- ---------------------------------------------------------------------------
-- bootstrap_first_main_admin: race lock + active account
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_first_main_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Serialize zero-Main-Admin races across concurrent callers.
  perform pg_advisory_xact_lock(hashtext('medverse.bootstrap_first_main_admin'));

  select account_status into v_status from public.profiles where id = v_uid;
  if not found then
    raise exception 'profile not found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'account_not_eligible';
  end if;
  if exists (select 1 from public.profiles where is_main_admin) then
    raise exception 'main_admin_exists';
  end if;

  perform set_config('medverse.bootstrap_first_main_admin', '1', true);
  update public.profiles
  set role = 'admin',
      is_main_admin = true
  where id = v_uid;
  perform set_config('medverse.bootstrap_first_main_admin', '', true);

  perform public.log_audit(
    'main_admin_bootstrapped',
    'profile',
    v_uid,
    jsonb_build_object('via', 'bootstrap_first_main_admin')
  );
end;
$$;

comment on function public.bootstrap_first_main_admin() is
  'One-time: promote caller to Main Admin only when zero Main Admins exist. Advisory-locked; caller must be active. Not a re-bootstrap when any Main Admin exists.';

-- ---------------------------------------------------------------------------
-- Curriculum writes: manage_curriculum (SELECT remains is_admin)
-- ---------------------------------------------------------------------------
drop policy if exists years_admin_all on public.years;
create policy years_admin_select on public.years
  for select using (public.is_admin());
create policy years_admin_insert on public.years
  for insert with check (public.has_permission('manage_curriculum'));
create policy years_admin_update on public.years
  for update
  using (public.has_permission('manage_curriculum'))
  with check (public.has_permission('manage_curriculum'));
create policy years_admin_delete on public.years
  for delete using (public.has_permission('manage_curriculum'));

drop policy if exists subjects_admin_all on public.subjects;
create policy subjects_admin_select on public.subjects
  for select using (public.is_admin());
create policy subjects_admin_insert on public.subjects
  for insert with check (public.has_permission('manage_curriculum'));
create policy subjects_admin_update on public.subjects
  for update
  using (public.has_permission('manage_curriculum'))
  with check (public.has_permission('manage_curriculum'));
create policy subjects_admin_delete on public.subjects
  for delete using (public.has_permission('manage_curriculum'));

drop policy if exists books_admin_all on public.books;
create policy books_admin_select on public.books
  for select using (public.is_admin());
create policy books_admin_insert on public.books
  for insert with check (public.has_permission('manage_curriculum'));
create policy books_admin_update on public.books
  for update
  using (public.has_permission('manage_curriculum'))
  with check (public.has_permission('manage_curriculum'));
create policy books_admin_delete on public.books
  for delete using (public.has_permission('manage_curriculum'));

drop policy if exists chapters_admin_all on public.chapters;
create policy chapters_admin_select on public.chapters
  for select using (public.is_admin());
create policy chapters_admin_insert on public.chapters
  for insert with check (public.has_permission('manage_curriculum'));
create policy chapters_admin_update on public.chapters
  for update
  using (public.has_permission('manage_curriculum'))
  with check (public.has_permission('manage_curriculum'));
create policy chapters_admin_delete on public.chapters
  for delete using (public.has_permission('manage_curriculum'));

drop policy if exists topics_admin_all on public.topics;
create policy topics_admin_select on public.topics
  for select using (public.is_admin());
create policy topics_admin_insert on public.topics
  for insert with check (public.has_permission('manage_curriculum'));
create policy topics_admin_update on public.topics
  for update
  using (public.has_permission('manage_curriculum'))
  with check (public.has_permission('manage_curriculum'));
create policy topics_admin_delete on public.topics
  for delete using (public.has_permission('manage_curriculum'));
