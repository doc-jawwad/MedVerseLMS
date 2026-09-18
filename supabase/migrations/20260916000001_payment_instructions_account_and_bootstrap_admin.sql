-- 8G-5 hardening:
-- 1) get_payment_instructions requires account_allows_lms() (account status,
--    not subscription).
-- 2) bootstrap_first_main_admin() for VPS/dev account scripts that cannot send
--    opaque sb_secret_* as a PostgREST Bearer.

create or replace function public.get_payment_instructions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.payment_settings%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  select * into v
  from public.payment_settings
  where tenant_id = public.default_tenant()
    and is_active;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'bank_name', v.bank_name,
    'account_title', v.account_title,
    'account_number', v.account_number,
    'iban', v.iban,
    'payment_instructions', v.payment_instructions,
    'qr_reference', v.qr_reference,
    'currency', v.currency
  );
end;
$$;

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
       and not public.has_permission('manage_admins') then
      if not public.is_admin() then
        raise exception 'is_main_admin changes require admin';
      else
        raise exception 'permission_denied';
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

create or replace function public.bootstrap_first_main_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile not found';
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

revoke execute on function public.bootstrap_first_main_admin() from public, anon;
grant execute on function public.bootstrap_first_main_admin() to authenticated, service_role;
