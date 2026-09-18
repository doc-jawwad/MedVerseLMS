-- Pre-8J: subscription grace (0/1/2 days), paid_access_mode, expiry
-- warning inserts, and central evaluator updates. Year isolation remains
-- has_active_enrollment / can_view_* (tested in 150_year_isolation.sql).

-- ---------------------------------------------------------------------------
-- Tenant default grace + snapshotted per-subscription columns
-- ---------------------------------------------------------------------------
alter table public.payment_settings
  add column if not exists subscription_grace_days int not null default 0;

alter table public.payment_settings
  drop constraint if exists payment_settings_subscription_grace_days_check;
alter table public.payment_settings
  add constraint payment_settings_subscription_grace_days_check
  check (subscription_grace_days in (0, 1, 2));

alter table public.subscriptions
  add column if not exists grace_days int not null default 0;
alter table public.subscriptions
  drop constraint if exists subscriptions_grace_days_check;
alter table public.subscriptions
  add constraint subscriptions_grace_days_check
  check (grace_days in (0, 1, 2));

alter table public.subscriptions
  add column if not exists paid_access_mode text not null default 'all_entitled';
alter table public.subscriptions
  drop constraint if exists subscriptions_paid_access_mode_check;
alter table public.subscriptions
  add constraint subscriptions_paid_access_mode_check
  check (paid_access_mode in ('all_entitled', 'grants_only'));

comment on column public.payment_settings.subscription_grace_days is
  'Tenant default copied onto new subscriptions. 0, 1, or 2 days after ends_at.';
comment on column public.subscriptions.grace_days is
  'Snapshotted at activate; paid access until ends_at + grace_days.';
comment on column public.subscriptions.paid_access_mode is
  'all_entitled: paid entitlement + grants. grants_only: paid resources need a grant.';

-- ---------------------------------------------------------------------------
-- In-app expiry warning rows (8L UI later)
-- ---------------------------------------------------------------------------
create table if not exists public.student_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'subscription_expiry_7d',
    'subscription_expiry_3d',
    'subscription_expiry_1d'
  )),
  ref_id uuid,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists student_notifications_unique_kind
  on public.student_notifications (student_id, kind, ref_id);

create index if not exists student_notifications_student_idx
  on public.student_notifications (student_id, created_at desc);

alter table public.student_notifications enable row level security;

drop policy if exists student_notifications_select on public.student_notifications;
create policy student_notifications_select on public.student_notifications
  for select using (student_id = (select auth.uid()) or public.is_admin());

drop policy if exists student_notifications_update_own on public.student_notifications;
create policy student_notifications_update_own on public.student_notifications
  for update using (student_id = (select auth.uid()))
  with check (
    student_id = (select auth.uid())
    and kind is not distinct from kind
    and ref_id is not distinct from ref_id
  );

-- ---------------------------------------------------------------------------
-- Time helpers
-- ---------------------------------------------------------------------------
create or replace function public.subscription_grace_until(
  p_ends_at timestamptz,
  p_grace_days int
)
returns timestamptz
language sql
immutable
parallel safe
set search_path = public
as $$
  select p_ends_at + make_interval(days => coalesce(p_grace_days, 0));
$$;

create or replace function public.tenant_subscription_grace_days()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select subscription_grace_days
      from public.payment_settings
      where tenant_id = public.default_tenant()
      limit 1
    ),
    0
  );
$$;

create or replace function public.subscription_is_live_at(
  p_status text,
  p_ends_at timestamptz,
  p_grace_days int,
  p_now timestamptz default now()
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select p_status = 'active'
    and p_now < public.subscription_grace_until(p_ends_at, p_grace_days);
$$;

create or replace function public.subscription_expiry_warning_kind(
  p_ends_at timestamptz,
  p_now timestamptz default now()
)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_ends_at <= p_now then null
    when p_ends_at - p_now <= interval '1 day' then 'subscription_expiry_1d'
    when p_ends_at - p_now <= interval '3 days' then 'subscription_expiry_3d'
    when p_ends_at - p_now <= interval '7 days' then 'subscription_expiry_7d'
    else null
  end;
$$;

create or replace function public.emit_subscription_expiry_warnings(
  p_student_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_inserted int;
begin
  insert into public.student_notifications (student_id, kind, ref_id, payload)
  select
    s.student_id,
    k.kind,
    s.id,
    jsonb_build_object('ends_at', s.ends_at, 'grace_days', s.grace_days)
  from public.subscriptions s
  cross join lateral (
    select unnest(array[
      'subscription_expiry_7d',
      'subscription_expiry_3d',
      'subscription_expiry_1d'
    ]) as kind
  ) k
  where s.status = 'active'
    and s.ends_at > now()
    and (
      (k.kind = 'subscription_expiry_7d' and s.ends_at - now() <= interval '7 days')
      or (k.kind = 'subscription_expiry_3d' and s.ends_at - now() <= interval '3 days')
      or (k.kind = 'subscription_expiry_1d' and s.ends_at - now() <= interval '1 day')
    )
    and (p_student_id is null or s.student_id = p_student_id)
  on conflict (student_id, kind, ref_id) do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Live evaluation including grace
-- ---------------------------------------------------------------------------
create or replace function public.expire_due_subscriptions(p_student_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid := p_student_id;
  v_count int;
begin
  if v_student is null then
    if public.is_admin() or (select auth.uid()) is null then
      null;
    else
      v_student := (select auth.uid());
    end if;
  elsif (select auth.uid()) is not null
     and not public.is_admin()
     and v_student is distinct from (select auth.uid()) then
    v_student := (select auth.uid());
  end if;

  perform public.emit_subscription_expiry_warnings(v_student);

  update public.subscriptions
  set status = 'expired'
  where status = 'active'
    and public.subscription_grace_until(ends_at, grace_days) <= now()
    and (v_student is null or student_id = v_student);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.has_live_subscription()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.subscriptions s
      where s.student_id = (select auth.uid())
        and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
    );
$$;

create or replace function public.has_live_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and p_plan_id is not null
    and exists (
      select 1 from public.subscriptions s
      where s.student_id = (select auth.uid())
        and s.plan_id = p_plan_id
        and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
    );
$$;

create or replace function public.live_paid_access_is_grants_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.student_id = (select auth.uid())
      and public.subscription_is_live_at(s.status, s.ends_at, s.grace_days, now())
      and s.paid_access_mode = 'grants_only'
  );
$$;

create or replace function public.resource_entitlement_allows(
  p_entitlement text,
  p_required_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entitlement
    when 'free' then true
    when 'any_subscription' then
      not public.live_paid_access_is_grants_only()
      and public.has_live_subscription()
    when 'plan' then
      not public.live_paid_access_is_grants_only()
      and p_required_plan_id is not null
      and public.has_live_plan(p_required_plan_id)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- activate_subscription: extra grace / access-mode args (replace overload)
-- ---------------------------------------------------------------------------
drop function if exists public.activate_subscription(uuid, uuid, timestamptz, timestamptz, uuid);

create or replace function public.activate_subscription(
  p_student_id uuid,
  p_plan_id uuid,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_application_id uuid default null,
  p_grace_days int default null,
  p_paid_access_mode text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_grace int;
  v_mode text;
begin
  perform public.require_permission('manage_subscriptions');
  perform public.expire_due_subscriptions(p_student_id);

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if not v_plan.is_active then
    raise exception 'plan_inactive';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id) then
    raise exception 'student_not_found';
  end if;
  if exists (
    select 1 from public.subscriptions
    where student_id = p_student_id
      and public.subscription_is_live_at(status, ends_at, grace_days, now())
  ) then
    raise exception 'subscription_already_active';
  end if;

  v_start := coalesce(p_starts_at, now());
  v_end := coalesce(p_ends_at, v_start + make_interval(days => v_plan.duration_days));
  v_grace := coalesce(p_grace_days, public.tenant_subscription_grace_days());
  if v_grace not in (0, 1, 2) then
    raise exception 'invalid_grace_days';
  end if;
  v_mode := coalesce(nullif(btrim(coalesce(p_paid_access_mode, '')), ''), 'all_entitled');
  if v_mode not in ('all_entitled', 'grants_only') then
    raise exception 'invalid_paid_access_mode';
  end if;
  if v_end <= v_start then
    raise exception 'invalid_subscription_window';
  end if;
  if public.subscription_grace_until(v_end, v_grace) <= now() then
    raise exception 'subscription_already_ended';
  end if;

  insert into public.subscriptions (
    student_id, plan_id, status, starts_at, ends_at, application_id,
    grace_days, paid_access_mode, activated_by, activated_at
  ) values (
    p_student_id, p_plan_id, 'active', v_start, v_end, p_application_id,
    v_grace, v_mode, (select auth.uid()), now()
  )
  returning id into v_id;

  perform public.log_audit(
    'subscription_activated',
    'subscription',
    v_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'plan_id', p_plan_id,
      'is_complimentary', v_plan.is_complimentary,
      'old_status', null,
      'new_status', 'active',
      'old_starts_at', null,
      'new_starts_at', v_start,
      'old_ends_at', null,
      'new_ends_at', v_end,
      'grace_days', v_grace,
      'paid_access_mode', v_mode
    )
  );
  return v_id;
end;
$$;

create or replace function public.extend_subscription(
  p_subscription_id uuid,
  p_days int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_days int;
  v_new_end timestamptz;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  perform public.expire_due_subscriptions(v_row.student_id);
  select * into v_row from public.subscriptions where id = p_subscription_id;

  if not public.subscription_is_live_at(v_row.status, v_row.ends_at, v_row.grace_days, now()) then
    raise exception 'subscription_not_live';
  end if;

  select coalesce(p_days, duration_days) into v_days
  from public.subscription_plans
  where id = v_row.plan_id;
  if v_days is null or v_days <= 0 then
    raise exception 'invalid_duration';
  end if;

  v_new_end := v_row.ends_at + make_interval(days => v_days);
  update public.subscriptions
  set ends_at = v_new_end
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_extended',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', v_row.status,
      'new_status', 'active',
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', v_new_end,
      'days', v_days
    )
  );
end;
$$;

create or replace function public.set_subscription_end(
  p_subscription_id uuid,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_new_status text;
begin
  perform public.require_permission('manage_subscriptions');
  if p_ends_at is null then
    raise exception 'invalid_subscription_window';
  end if;
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  if v_row.status is distinct from 'active' then
    raise exception 'subscription_not_active';
  end if;
  if p_ends_at <= v_row.starts_at then
    raise exception 'invalid_subscription_window';
  end if;

  v_new_status := case
    when public.subscription_grace_until(p_ends_at, v_row.grace_days) <= now()
      then 'expired'
    else 'active'
  end;
  update public.subscriptions
  set ends_at = p_ends_at,
      status = v_new_status
  where id = p_subscription_id;

  perform public.log_audit(
    'subscription_end_changed',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'old_status', v_row.status,
      'new_status', v_new_status,
      'old_starts_at', v_row.starts_at,
      'new_starts_at', v_row.starts_at,
      'old_ends_at', v_row.ends_at,
      'new_ends_at', p_ends_at
    )
  );
end;
$$;

create or replace function public.set_subscription_access(
  p_subscription_id uuid,
  p_grace_days int default null,
  p_paid_access_mode text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_grace int;
  v_mode text;
begin
  perform public.require_permission('manage_subscriptions');
  select * into v_row from public.subscriptions where id = p_subscription_id;
  if not found then
    raise exception 'subscription_not_found';
  end if;
  if v_row.status is distinct from 'active' then
    raise exception 'subscription_not_active';
  end if;
  v_grace := coalesce(p_grace_days, v_row.grace_days);
  v_mode := coalesce(nullif(btrim(coalesce(p_paid_access_mode, '')), ''), v_row.paid_access_mode);
  if v_grace not in (0, 1, 2) then
    raise exception 'invalid_grace_days';
  end if;
  if v_mode not in ('all_entitled', 'grants_only') then
    raise exception 'invalid_paid_access_mode';
  end if;
  update public.subscriptions
  set grace_days = v_grace,
      paid_access_mode = v_mode
  where id = p_subscription_id;
  perform public.log_audit(
    'subscription_access_changed',
    'subscription',
    p_subscription_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'old_grace_days', v_row.grace_days,
      'new_grace_days', v_grace,
      'old_paid_access_mode', v_row.paid_access_mode,
      'new_paid_access_mode', v_mode
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- payment settings: persist tenant grace
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_payment_settings(text, text, text, text, text, text, text, boolean);

create or replace function public.upsert_payment_settings(
  p_bank_name text default null,
  p_account_title text default null,
  p_account_number text default null,
  p_iban text default null,
  p_payment_instructions text default null,
  p_qr_reference text default null,
  p_currency text default null,
  p_is_active boolean default null,
  p_subscription_grace_days int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.payment_settings%rowtype;
  v_id uuid;
  v_currency text;
  v_grace int;
begin
  perform public.require_permission('manage_payment_settings');
  select * into v_old
  from public.payment_settings
  where tenant_id = public.default_tenant();

  v_currency := coalesce(
    nullif(btrim(coalesce(p_currency, '')), ''),
    v_old.currency,
    'PKR'
  );
  v_grace := coalesce(p_subscription_grace_days, v_old.subscription_grace_days, 0);
  if v_grace not in (0, 1, 2) then
    raise exception 'invalid_grace_days';
  end if;

  perform set_config('medverse.payment_settings_rpc', '1', true);
  if v_old.id is null then
    insert into public.payment_settings (
      bank_name, account_title, account_number, iban,
      payment_instructions, qr_reference, currency, is_active,
      subscription_grace_days
    ) values (
      coalesce(p_bank_name, ''),
      coalesce(p_account_title, ''),
      coalesce(p_account_number, ''),
      coalesce(p_iban, ''),
      coalesce(p_payment_instructions, ''),
      coalesce(p_qr_reference, ''),
      v_currency,
      coalesce(p_is_active, false),
      v_grace
    )
    returning id into v_id;
  else
    update public.payment_settings
    set
      bank_name = coalesce(p_bank_name, bank_name),
      account_title = coalesce(p_account_title, account_title),
      account_number = coalesce(p_account_number, account_number),
      iban = coalesce(p_iban, iban),
      payment_instructions = coalesce(p_payment_instructions, payment_instructions),
      qr_reference = coalesce(p_qr_reference, qr_reference),
      currency = v_currency,
      is_active = coalesce(p_is_active, is_active),
      subscription_grace_days = v_grace
    where id = v_old.id
    returning id into v_id;
  end if;
  perform set_config('medverse.payment_settings_rpc', '', true);

  perform public.log_audit(
    'payment_settings_updated',
    'payment_settings',
    v_id,
    jsonb_build_object(
      'old_is_active', v_old.is_active,
      'new_is_active', coalesce(p_is_active, v_old.is_active),
      'old_currency', v_old.currency,
      'new_currency', v_currency,
      'old_grace_days', v_old.subscription_grace_days,
      'new_grace_days', v_grace
    )
  );
  return v_id;
exception
  when others then
    perform set_config('medverse.payment_settings_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.subscription_grace_until(timestamptz, int) from public, anon;
revoke execute on function public.tenant_subscription_grace_days() from public, anon;
revoke execute on function public.subscription_is_live_at(text, timestamptz, int, timestamptz) from public, anon;
revoke execute on function public.subscription_expiry_warning_kind(timestamptz, timestamptz) from public, anon;
revoke execute on function public.emit_subscription_expiry_warnings(uuid) from public, anon;
revoke execute on function public.live_paid_access_is_grants_only() from public, anon;
revoke execute on function public.set_subscription_access(uuid, int, text) from public, anon;
revoke execute on function public.activate_subscription(uuid, uuid, timestamptz, timestamptz, uuid, int, text) from public, anon;
revoke execute on function public.upsert_payment_settings(text, text, text, text, text, text, text, boolean, int) from public, anon;

grant execute on function public.subscription_grace_until(timestamptz, int) to authenticated, service_role;
grant execute on function public.tenant_subscription_grace_days() to authenticated, service_role;
grant execute on function public.subscription_is_live_at(text, timestamptz, int, timestamptz) to authenticated, service_role;
grant execute on function public.subscription_expiry_warning_kind(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.emit_subscription_expiry_warnings(uuid) to authenticated, service_role;
grant execute on function public.live_paid_access_is_grants_only() to authenticated, service_role;
grant execute on function public.set_subscription_access(uuid, int, text) to authenticated, service_role;
grant execute on function public.activate_subscription(uuid, uuid, timestamptz, timestamptz, uuid, int, text) to authenticated, service_role;
grant execute on function public.upsert_payment_settings(text, text, text, text, text, text, text, boolean, int) to authenticated, service_role;
