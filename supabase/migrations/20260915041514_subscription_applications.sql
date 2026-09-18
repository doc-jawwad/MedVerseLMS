-- Step 8F: subscription_applications, payment_settings, screenshot-key authz.
-- Bytes live in private Cloudflare R2; this schema stores object keys only.
-- Currency default PKR is an owner decision (docs/permissions.md).
-- cancelled exists for compatibility; no student/admin cancel RPC in this step.

-- ---------------------------------------------------------------------------
-- payment_settings (one row per tenant)
-- ---------------------------------------------------------------------------
create table public.payment_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  bank_name text not null default '',
  account_title text not null default '',
  account_number text not null default '',
  iban text not null default '',
  payment_instructions text not null default '',
  qr_reference text not null default '',
  currency text not null default 'PKR',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create trigger payment_settings_updated_at
  before update on public.payment_settings
  for each row execute function public.set_updated_at();

comment on column public.payment_settings.currency is
  'Owner default PKR. Not a hardcoded UI string; changeable per tenant.';

insert into public.payment_settings (currency, is_active)
values ('PKR', false);

-- ---------------------------------------------------------------------------
-- subscription_applications
-- ---------------------------------------------------------------------------
create table public.subscription_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.subscription_plans (id),
  amount numeric not null check (amount > 0),
  currency text not null default 'PKR',
  screenshot_object_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(currency) <> ''),
  check (screenshot_object_key !~* '://'),
  check (screenshot_object_key like 'payment-proofs/%'),
  check (char_length(screenshot_object_key) between 20 and 512)
);

comment on column public.subscription_applications.currency is
  'Owner default PKR. Copied from payment_settings or the create RPC.';
comment on column public.subscription_applications.screenshot_object_key is
  'Private R2 object key. Never a public URL.';
comment on column public.subscription_applications.status is
  'cancelled is stored for compatibility; no cancel RPC/UI in this step.';

create unique index subscription_applications_one_pending
  on public.subscription_applications (student_id)
  where status = 'pending';

create index subscription_applications_student_idx
  on public.subscription_applications (student_id);

create index subscription_applications_status_idx
  on public.subscription_applications (status);

create trigger subscription_applications_updated_at
  before update on public.subscription_applications
  for each row execute function public.set_updated_at();

alter table public.subscriptions
  add constraint subscriptions_application_fk
  foreign key (application_id) references public.subscription_applications (id);

-- ---------------------------------------------------------------------------
-- RLS (writes are RPC-only)
-- ---------------------------------------------------------------------------
alter table public.payment_settings enable row level security;
alter table public.subscription_applications enable row level security;

create policy payment_settings_admin_select on public.payment_settings
  for select using (public.is_admin());

create policy subscription_applications_select on public.subscription_applications
  for select using (
    student_id = (select auth.uid())
    or public.is_admin()
  );

create or replace function public.protect_subscription_application()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.subscription_application_rpc', true) is distinct from '1' then
    raise exception 'subscription_application_rpc_only';
  end if;
  return new;
end;
$$;

drop trigger if exists subscription_applications_rpc_only on public.subscription_applications;
create trigger subscription_applications_rpc_only
  before insert or update or delete on public.subscription_applications
  for each row execute function public.protect_subscription_application();

create or replace function public.protect_payment_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('medverse.payment_settings_rpc', true) is distinct from '1' then
    raise exception 'payment_settings_rpc_only';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_settings_rpc_only on public.payment_settings;
create trigger payment_settings_rpc_only
  before insert or update or delete on public.payment_settings
  for each row execute function public.protect_payment_settings();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.payment_screenshot_key_prefix(p_student_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'payment-proofs/' || public.default_tenant()::text || '/' || p_student_id::text || '/';
$$;

create or replace function public.resolve_application_plan_id(p_plan_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n int;
begin
  if p_plan_id is not null then
    select id into v_id
    from public.subscription_plans
    where id = p_plan_id and is_active;
    if v_id is null then
      raise exception 'plan_not_found';
    end if;
    return v_id;
  end if;

  select count(*) into v_n
  from public.subscription_plans
  where is_active and not is_complimentary;
  if v_n = 1 then
    select id into v_id
    from public.subscription_plans
    where is_active and not is_complimentary;
    return v_id;
  end if;

  select count(*) into v_n from public.subscription_plans where is_active;
  if v_n = 1 then
    select id into v_id from public.subscription_plans where is_active;
    return v_id;
  end if;

  raise exception 'plan_required';
end;
$$;

create or replace function public.resolve_application_currency(p_currency text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  v := nullif(btrim(coalesce(p_currency, '')), '');
  if v is not null then
    return v;
  end if;
  select currency into v
  from public.payment_settings
  where tenant_id = public.default_tenant();
  return coalesce(nullif(btrim(coalesce(v, '')), ''), 'PKR');
end;
$$;

create or replace function public.assert_own_screenshot_object_key(
  p_student_id uuid,
  p_key text
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_key is null
     or p_key ~* '://'
     or p_key not like public.payment_screenshot_key_prefix(p_student_id) || '%'
     or char_length(p_key) not between 20 and 512 then
    raise exception 'invalid_screenshot_object_key';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Student RPCs
-- ---------------------------------------------------------------------------
create or replace function public.allocate_payment_screenshot_object_key()
returns text
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
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  return public.payment_screenshot_key_prefix(v_uid) || gen_random_uuid()::text;
end;
$$;

create or replace function public.create_subscription_application(
  p_amount numeric,
  p_screenshot_object_key text,
  p_plan_id uuid default null,
  p_currency text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_plan uuid;
  v_currency text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  perform public.assert_own_screenshot_object_key(v_uid, p_screenshot_object_key);
  v_plan := public.resolve_application_plan_id(p_plan_id);
  v_currency := public.resolve_application_currency(p_currency);

  if exists (
    select 1 from public.subscription_applications
    where student_id = v_uid and status = 'pending'
  ) then
    raise exception 'application_already_pending';
  end if;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  insert into public.subscription_applications (
    student_id, plan_id, amount, currency, screenshot_object_key, status
  ) values (
    v_uid, v_plan, p_amount, v_currency, p_screenshot_object_key, 'pending'
  )
  returning id into v_id;
  perform set_config('medverse.subscription_application_rpc', '', true);
  return v_id;
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

create or replace function public.update_pending_subscription_application(
  p_application_id uuid,
  p_amount numeric default null,
  p_screenshot_object_key text default null,
  p_plan_id uuid default null,
  p_currency text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.subscription_applications%rowtype;
  v_plan uuid;
  v_currency text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  select * into v_row
  from public.subscription_applications
  where id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  if v_row.student_id is distinct from v_uid then
    raise exception 'application_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'application_not_pending';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  v_key := coalesce(p_screenshot_object_key, v_row.screenshot_object_key);
  perform public.assert_own_screenshot_object_key(v_uid, v_key);
  v_plan := case
    when p_plan_id is null then v_row.plan_id
    else public.resolve_application_plan_id(p_plan_id)
  end;
  v_currency := case
    when p_currency is null then v_row.currency
    else public.resolve_application_currency(p_currency)
  end;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set
    amount = coalesce(p_amount, amount),
    screenshot_object_key = v_key,
    plan_id = v_plan,
    currency = v_currency
  where id = p_application_id
    and status = 'pending'
    and student_id = v_uid;
  perform set_config('medverse.subscription_application_rpc', '', true);
end;
$$;

create or replace function public.authorize_payment_screenshot_access(
  p_application_id uuid,
  p_purpose text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.subscription_applications%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_purpose is null or p_purpose not in ('read', 'write') then
    raise exception 'invalid_screenshot_purpose';
  end if;

  select * into v_row
  from public.subscription_applications
  where id = p_application_id;
  if not found then
    raise exception 'screenshot_access_denied';
  end if;

  if p_purpose = 'write' then
    if v_row.student_id is distinct from v_uid
       or v_row.status is distinct from 'pending'
       or not public.account_allows_lms() then
      raise exception 'screenshot_access_denied';
    end if;
    return v_row.screenshot_object_key;
  end if;

  if v_row.student_id = v_uid and v_row.status = 'pending' then
    return v_row.screenshot_object_key;
  end if;
  if public.has_permission('review_subscription_applications') then
    return v_row.screenshot_object_key;
  end if;
  raise exception 'screenshot_access_denied';
end;
$$;

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

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.upsert_payment_settings(
  p_bank_name text default null,
  p_account_title text default null,
  p_account_number text default null,
  p_iban text default null,
  p_payment_instructions text default null,
  p_qr_reference text default null,
  p_currency text default null,
  p_is_active boolean default null
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

  perform set_config('medverse.payment_settings_rpc', '1', true);
  if v_old.id is null then
    insert into public.payment_settings (
      bank_name, account_title, account_number, iban,
      payment_instructions, qr_reference, currency, is_active
    ) values (
      coalesce(p_bank_name, ''),
      coalesce(p_account_title, ''),
      coalesce(p_account_number, ''),
      coalesce(p_iban, ''),
      coalesce(p_payment_instructions, ''),
      coalesce(p_qr_reference, ''),
      v_currency,
      coalesce(p_is_active, false)
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
      is_active = coalesce(p_is_active, is_active)
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
      'old_bank_name', v_old.bank_name,
      'new_bank_name', coalesce(p_bank_name, v_old.bank_name)
    )
  );
  return v_id;
exception
  when others then
    perform set_config('medverse.payment_settings_rpc', '', true);
    raise;
end;
$$;

create or replace function public.reject_subscription_application(
  p_application_id uuid,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_applications%rowtype;
begin
  perform public.require_permission('review_subscription_applications');
  select * into v_row from public.subscription_applications where id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'application_not_pending';
  end if;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set
    status = 'rejected',
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    review_note = p_review_note
  where id = p_application_id
    and status = 'pending';
  perform set_config('medverse.subscription_application_rpc', '', true);

  perform public.log_audit(
    'subscription_application_rejected',
    'subscription_application',
    p_application_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'amount', v_row.amount,
      'currency', v_row.currency,
      'old_status', 'pending',
      'new_status', 'rejected',
      'review_note', p_review_note
    )
  );
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

create or replace function public.approve_subscription_application(
  p_application_id uuid,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscription_applications%rowtype;
  v_live uuid;
  v_sub uuid;
begin
  perform public.require_permission('review_subscription_applications');
  perform public.require_permission('manage_subscriptions');

  select * into v_row from public.subscription_applications where id = p_application_id;
  if not found then
    raise exception 'application_not_found';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'application_not_pending';
  end if;
  if v_row.plan_id is null then
    raise exception 'plan_required';
  end if;

  perform public.expire_due_subscriptions(v_row.student_id);

  select id into v_live
  from public.subscriptions
  where student_id = v_row.student_id
    and status = 'active'
    and now() < ends_at;

  if v_live is not null then
    perform public.extend_subscription(v_live, null);
    update public.subscriptions
    set application_id = p_application_id
    where id = v_live;
    if exists (
      select 1 from public.subscriptions
      where id = v_live and plan_id is distinct from v_row.plan_id
    ) then
      perform public.assign_subscription_plan(v_live, v_row.plan_id);
    end if;
    v_sub := v_live;
  else
    v_sub := public.activate_subscription(
      v_row.student_id,
      v_row.plan_id,
      null,
      null,
      p_application_id
    );
  end if;

  perform set_config('medverse.subscription_application_rpc', '1', true);
  update public.subscription_applications
  set
    status = 'approved',
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    review_note = p_review_note
  where id = p_application_id
    and status = 'pending';
  perform set_config('medverse.subscription_application_rpc', '', true);

  perform public.log_audit(
    'subscription_application_approved',
    'subscription_application',
    p_application_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'plan_id', v_row.plan_id,
      'subscription_id', v_sub,
      'amount', v_row.amount,
      'currency', v_row.currency,
      'old_status', 'pending',
      'new_status', 'approved',
      'review_note', p_review_note
    )
  );
  return v_sub;
exception
  when others then
    perform set_config('medverse.subscription_application_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.allocate_payment_screenshot_object_key() from public, anon;
grant execute on function public.allocate_payment_screenshot_object_key() to authenticated, service_role;
revoke execute on function public.create_subscription_application(numeric, text, uuid, text) from public, anon;
grant execute on function public.create_subscription_application(numeric, text, uuid, text) to authenticated, service_role;
revoke execute on function public.update_pending_subscription_application(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.update_pending_subscription_application(uuid, numeric, text, uuid, text) to authenticated, service_role;
revoke execute on function public.authorize_payment_screenshot_access(uuid, text) from public, anon;
grant execute on function public.authorize_payment_screenshot_access(uuid, text) to authenticated, service_role;
revoke execute on function public.get_payment_instructions() from public, anon;
grant execute on function public.get_payment_instructions() to authenticated, service_role;
revoke execute on function public.upsert_payment_settings(text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.upsert_payment_settings(text, text, text, text, text, text, text, boolean) to authenticated, service_role;
revoke execute on function public.reject_subscription_application(uuid, text) from public, anon;
grant execute on function public.reject_subscription_application(uuid, text) to authenticated, service_role;
revoke execute on function public.approve_subscription_application(uuid, text) from public, anon;
grant execute on function public.approve_subscription_application(uuid, text) to authenticated, service_role;
revoke execute on function public.payment_screenshot_key_prefix(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_application_plan_id(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_application_currency(text) from public, anon, authenticated;
revoke execute on function public.assert_own_screenshot_object_key(uuid, text) from public, anon, authenticated;
